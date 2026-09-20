import { useEffect, useRef, useState } from "react";
import type { ReactElement, FormEvent } from "react";

import {
  createInitialPhoneControllerStatus,
  PhoneMotionController,
  type PhoneControllerStatus,
} from "../game/input/PhoneMotionController";
import { normalizeRoomCode } from "../game/input/MotionTypes";

function initialRoomFromUrl(): string {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get("room"));
}

function connectionLabel(status: PhoneControllerStatus): string {
  if (status.connection === "error") return "RELAY ERROR";
  if (status.connection === "disconnected") return "RECONNECTING";
  if (status.peerConnected) return "DESKTOP PAIRED";
  if (status.connection === "waiting") return "WAITING FOR DESKTOP";
  if (status.connection === "connected") return "RELAY CONNECTED";
  if (status.connection === "connecting") return "CONNECTING";
  return "NOT CONNECTED";
}

export default function ControllerScreen(): ReactElement {
  const [roomInput, setRoomInput] = useState(initialRoomFromUrl);
  const [joinedRoom, setJoinedRoom] = useState(initialRoomFromUrl);
  const [joinError, setJoinError] = useState("");
  const [status, setStatus] = useState<PhoneControllerStatus>(() =>
    createInitialPhoneControllerStatus(initialRoomFromUrl()),
  );
  const controllerRef = useRef<PhoneMotionController | null>(null);

  useEffect(() => {
    if (!joinedRoom) {
      setStatus(createInitialPhoneControllerStatus(""));
      return;
    }

    const controller = new PhoneMotionController(joinedRoom, setStatus);
    controllerRef.current = controller;
    controller.start();
    return () => {
      controller.setBlocking(false);
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [joinedRoom]);

  const joinRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const room = normalizeRoomCode(roomInput);
    if (!room) {
      setJoinError("Use the six-character room code shown on the desktop.");
      return;
    }
    setJoinError("");
    setRoomInput(room);
    setJoinedRoom(room);
    const url = new URL(window.location.href);
    url.searchParams.set("room", room);
    window.history.replaceState(null, "", url);
  };

  const enableMotion = async (): Promise<boolean> => {
    const controller = controllerRef.current;
    if (!controller) return false;
    return controller.enableMotion();
  };

  const recenter = () => {
    controllerRef.current?.recenter();
  };

  const setBlockHeld = (held: boolean) => {
    controllerRef.current?.setBlocking(held);
  };

  const tapReady = async () => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (status.ready) {
      controller.setReady(false);
      return;
    }
    if (!status.peerConnected) return;
    const motionOk =
      status.sensorState === "active" ||
      status.orientationSeen ||
      (await enableMotion());
    if (!motionOk) return;
    // Lobby Ready is fullscreen — auto-recenter if we have orientation.
    if (!status.calibrated) {
      // enableMotion is async; give orientation a beat, then recenter.
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      controller.recenter();
    }
    controller.setReady(true);
  };

  const connected = status.peerConnected;
  const motionEnabled = status.sensorState === "active" || status.orientationSeen;
  const blocking = status.blocking;
  const phase = status.phase;
  const readyEligible = Boolean(joinedRoom && connected);

  if (!joinedRoom) {
    return (
      <main className="controller-shell controller-shell-join">
        <section className="controller-card">
          <header className="controller-header">
            <p className="eyebrow">CHAMBARA</p>
            <h1>Join room</h1>
            <p className="controller-lede">
              Enter the six-character code from the desktop lobby.
            </p>
            <div className={"connection-pill connection-" + status.connection}>
              <span className="connection-dot" />
              {connectionLabel(status)}
            </div>
          </header>
          <form className="room-form" onSubmit={joinRoom}>
            <label htmlFor="controller-room">ROOM / SESSION CODE</label>
            <div className="room-input-row">
              <input
                id="controller-room"
                value={roomInput}
                onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={6}
                placeholder="ABC123"
                aria-describedby={joinError ? "room-error" : undefined}
              />
              <button className="controller-secondary-button" type="submit">
                Join
              </button>
            </div>
            {joinError && <p id="room-error" className="controller-error">{joinError}</p>}
          </form>
        </section>
      </main>
    );
  }

  if (phase !== "fight") {
    return (
      <main className="controller-fight-shell controller-lobby-shell" aria-label="Lobby ready">
        <button
          type="button"
          className={"controller-ready-fullscreen" + (status.ready ? " is-ready" : "")}
          aria-pressed={status.ready}
          disabled={!status.ready && !readyEligible}
          onClick={() => void tapReady()}
        >
          <span className="controller-ready-fullscreen-kicker">
            {connected ? connectionLabel(status) : "WAITING FOR DESKTOP"}
          </span>
          <strong>
            {status.ready
              ? "READY"
              : readyEligible
                ? "READY"
                : "WAITING"}
          </strong>
          <span className="controller-ready-fullscreen-hint">
            {status.ready
              ? "Tap to cancel"
              : !connected
                ? "Pair with desktop first"
                : !motionEnabled
                  ? "Tap to enable motion + ready up"
                  : "Tap when you are set"}
          </span>
        </button>
      </main>
    );
  }

  return (
    <main className="controller-fight-shell" aria-label="Fight controls">
      <button
        type="button"
        className="controller-fight-recenter"
        onClick={() => {
          void enableMotion().then((ok) => {
            if (ok || status.orientationSeen) recenter();
          });
        }}
        disabled={!status.orientationSeen && status.sensorState !== "active"}
      >
        RECENTER
      </button>
      <div className="controller-fight-body">
        <div className="controller-fight-void" aria-hidden="true" />
        <button
          type="button"
          className={"controller-fight-block" + (blocking ? " is-held" : "")}
          aria-pressed={blocking}
          aria-label="Hold to block"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setBlockHeld(true);
          }}
          onPointerUp={() => setBlockHeld(false)}
          onPointerCancel={() => setBlockHeld(false)}
          onLostPointerCapture={() => setBlockHeld(false)}
          onContextMenu={(event) => event.preventDefault()}
        >
          <strong>{blocking ? "BLOCKING" : "HOLD TO BLOCK"}</strong>
        </button>
      </div>
    </main>
  );
}
