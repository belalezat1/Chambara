import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { WebSocket, WebSocketServer } from "ws";

type RelayRoom = {
  peers: Map<"host" | "phone", WebSocket>;
  phoneSessionGeneration: number;
  /** Latest phone sample waiting for a drained host socket (coalesce under backpressure). */
  pendingHostSample: object | null;
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: "chambara-motion-relay",
      configureServer(server) {
        const wss = new WebSocketServer({ noServer: true, maxPayload: 8_192 });
        const rooms = new Map<string, RelayRoom>();

        const trySend = (socket: WebSocket, message: object): boolean => {
          if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount >= 16_384) {
            return false;
          }
          socket.send(JSON.stringify(message));
          return true;
        };

        const flushPendingSample = (relayRoom: RelayRoom) => {
          const host = relayRoom.peers.get("host");
          if (!host || !relayRoom.pendingHostSample) return;
          if (trySend(host, relayRoom.pendingHostSample)) {
            relayRoom.pendingHostSample = null;
          }
        };

        const sendSampleToHost = (relayRoom: RelayRoom, message: object) => {
          const host = relayRoom.peers.get("host");
          if (!host) return;
          // Always keep only the newest sample so backpressure never creates holes.
          if (trySend(host, message)) {
            relayRoom.pendingHostSample = null;
            return;
          }
          relayRoom.pendingHostSample = message;
        };

        const notifyPeers = (room: RelayRoom) => {
          const message = {
            type: "peers",
            host: room.peers.has("host"),
            phone: room.peers.has("phone"),
            sessionGeneration: room.peers.has("phone")
              ? room.phoneSessionGeneration
              : null,
          };
          for (const socket of room.peers.values()) trySend(socket, message);
        };

        server.httpServer?.on("upgrade", (request, socket, head) => {
          const url = new URL(request.url ?? "", "http://localhost");
          if (url.pathname !== "/motion-ws") return;

          const room = url.searchParams.get("room") ?? "";
          const role = url.searchParams.get("role");
          if (!/^[A-Z0-9]{6}$/.test(room) || (role !== "host" && role !== "phone")) {
            socket.destroy();
            return;
          }

          wss.handleUpgrade(request, socket, head, (client) => {
            let relayRoom = rooms.get(room);
            if (!relayRoom) {
              relayRoom = {
                peers: new Map(),
                phoneSessionGeneration: 0,
                pendingHostSample: null,
              };
              rooms.set(room, relayRoom);
            }

            if (role === "phone") {
              relayRoom.phoneSessionGeneration += 1;
              relayRoom.pendingHostSample = null;
            }
            const sessionGeneration = relayRoom.phoneSessionGeneration;
            relayRoom.peers.get(role)?.close(4000, "Replaced by another connection");
            relayRoom.peers.set(role, client);
            notifyPeers(relayRoom);
            if (role === "host") flushPendingSample(relayRoom);

            client.on("message", (data) => {
              if (relayRoom?.peers.get(role) !== client) return;
              try {
                const message = JSON.parse(data.toString()) as Record<string, unknown>;
                if (role === "phone" && message.type === "sample") {
                  sendSampleToHost(relayRoom, { ...message, sessionGeneration });
                } else if (role === "host" && message.type === "reset") {
                  const phone = relayRoom?.peers.get("phone");
                  if (phone) trySend(phone, message);
                } else if (
                  message.type === "ping" &&
                  typeof message.time === "number"
                ) {
                  trySend(client, { type: "pong", time: message.time });
                }
              } catch {
                // Ignore malformed or oversized packets.
              }
            });

            // ws may emit bufferedAmountLow when the socket drains (if supported).
            client.on("bufferedAmountLow" as "close", () => {
              if (role === "host" && relayRoom?.peers.get("host") === client) {
                flushPendingSample(relayRoom);
              }
            });

            client.on("error", () => undefined);
            client.on("close", () => {
              if (relayRoom?.peers.get(role) !== client) return;
              relayRoom.peers.delete(role);
              if (role === "host") relayRoom.pendingHostSample = null;
              notifyPeers(relayRoom);
              if (relayRoom.peers.size === 0) {
                rooms.delete(room);
              }
            });
          });
        });

        // Periodically flush pending samples in case bufferedAmountLow is unavailable.
        const flushTimer = setInterval(() => {
          for (const relayRoom of rooms.values()) flushPendingSample(relayRoom);
        }, 16);

        server.httpServer?.on("close", () => {
          clearInterval(flushTimer);
          for (const relayRoom of rooms.values()) {
            for (const socket of relayRoom.peers.values()) socket.close(1001, "Relay stopped");
          }
          rooms.clear();
          wss.close();
        });
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    allowedHosts: [".trycloudflare.com"],
  },
});
