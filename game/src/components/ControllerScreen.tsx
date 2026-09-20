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

function formatQuaternion(
  quaternion: PhoneControllerStatus["lastQuaternion"],
): string {
  return quaternion ? quaternion.map((value) => value.toFixed(3)).join(" / ") : "—";
}

export default function ControllerScreen(): ReactElement {
  const [roomInput, setRoomInput] = useState(initialRoomFromUrl);
  const [joinedRoom, setJoinedRoom] = useState(initialRoomFromUrl);
  const [joinError, setJoinError] = useState("");
  const [swingThreshold, setSwingThreshold] = useState(12);
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
    controller.setSwingThreshold(swingThreshold);
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

  const enableMotion = () => {
    void controllerRef.current?.enableMotion();
  };

  const recenter = () => {
    controllerRef.current?.recenter();
  };

  const setBlockHeld = (held: boolean) => {
    controllerRef.current?.setBlocking(held);
  };

  const connected = status.peerConnected;
  const motionEnabled = status.sensorState === "active" || status.orientationSeen;
  const blocking = status.blocking;
  const readyEligible = Boolean(joinedRoom && connected && motionEnabled && status.calibrated);

  return (
    <main className="controller-shell">
      <section className="controller-card">
        <header className="controller-header">
          <p className="eyebrow">LUNA MAX // CHAMBARA</p>
          <h1>Phone controller</h1>
          <p className="controller-lede">
            Your phone steers the player&apos;s Shinai. Hold it flat with the
            screen facing up, top edge aimed at the monitor/opponent, and
            bottom edge toward you.
          </p>
          <ol className="controller-instructions">
            <li>Keep the phone roughly level.</li>
            <li>Tap Recenter while holding this neutral pose.</li>
            <li>Use a small tilt to place the guard; move near the rim before swinging.</li>
            <li>Hold the block zone to raise a vertical guard; tilt left/right only.</li>
          </ol>
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
          <p className="controller-help">
            {joinedRoom
              ? "Room " + joinedRoom + (connected ? " is paired." : " is ready to pair.")
              : "Type the code from the desktop to begin."}
          </p>
        </form>

        <label className="controller-help">
          Swing threshold: {swingThreshold} m/s² (lower is more sensitive)
          <input aria-label="Swing threshold" type="range" min="5" max="25" step="1"
            value={swingThreshold} onChange={(event) => {
              const value = Number(event.target.value);
              setSwingThreshold(value);
              controllerRef.current?.setSwingThreshold(value);
            }} />
        </label>
        <div className="controller-actions">
          <button
            className="controller-primary-button"
            type="button"
            onClick={enableMotion}
            disabled={!joinedRoom || status.sensorState === "requesting" || motionEnabled}
          >
            {status.sensorState === "requesting"
              ? "Requesting permission…"
              : motionEnabled
                ? "Motion enabled"
                : "Enable Motion"}
          </button>
          <button
            className="controller-secondary-button"
            type="button"
            onClick={recenter}
            disabled={!status.orientationSeen}
          >
            Recenter
          </button>
          <button
            className={"controller-ready-button" + (status.ready ? " is-ready" : "")}
            type="button"
            aria-pressed={status.ready}
            disabled={!status.ready && !readyEligible}
            onClick={() => controllerRef.current?.setReady(!status.ready)}
          >
            {status.ready
              ? "READY — TAP TO CANCEL"
              : readyEligible
                ? "READY FOR MATCH"
                : "PAIR + RECENTER TO READY"}
          </button>
        </div>

        <p className={"sensor-message sensor-" + status.sensorState} role="status">
          {status.sensorMessage}
        </p>

        <button
          type="button"
          className={"controller-block-zone" + (blocking ? " is-held" : "")}
          aria-pressed={blocking}
          aria-label="Hold to block"
          disabled={!joinedRoom}
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
          <span>
            {blocking
              ? "Guard is vertical — tilt left or right to angle it."
              : "Hold here. Swings are locked while blocking."}
          </span>
        </button>

        <div className="controller-metrics">
          <div className="controller-metric">
            <span>SENSOR ORIENTATION</span>
            <strong>
              {status.angles
                ? status.angles.map((value) => Math.round(value)).join("° / ") + "°"
                : "—"}
            </strong>
            <small>α / β / γ degrees</small>
          </div>
          <div className="controller-metric">
            <span>SEND RATE</span>
            <strong>{status.sentPerSecond ? status.sentPerSecond + " Hz" : "Waiting"}</strong>
            <small>newest sample, capped at 60 Hz</small>
          </div>
          <div className="controller-metric">
            <span>CALIBRATION</span>
            <strong>{status.calibrated ? "READY" : "NEUTRAL REQUIRED"}</strong>
            <small>relative quaternion</small>
          </div>
          <div className="controller-metric">
            <span>RELAY RTT</span>
            <strong>{status.relayRttMs === null ? "—" : status.relayRttMs + " ms"}</strong>
            <small>server round trip</small>
          </div>
        </div>

        <div className="controller-debug">
          <span>RAW DEVICE QUATERNION</span>
          <code>{formatQuaternion(status.rawQuaternion)}</code>
          <span className="controller-debug-secondary">CALIBRATION REFERENCE</span>
          <code>{formatQuaternion(status.calibrationReferenceQuaternion)}</code>
          <span className="controller-debug-secondary">RELATIVE / RECENTERED QUATERNION</span>
          <code>{formatQuaternion(status.lastQuaternion)}</code>
        </div>

        <footer className="controller-footer">
          <span className={status.secureContext ? "secure-ok" : "secure-warning"}>
            {status.secureContext ? "SECURE SENSOR ORIGIN" : "HTTPS REQUIRED FOR MOTION"}
          </span>
          <span>{status.motionSeen ? "DeviceMotion detected" : "DeviceOrientation is primary"}</span>
        </footer>
      </section>
    </main>
  );
}
