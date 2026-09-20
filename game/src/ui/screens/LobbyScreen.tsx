import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

import OnEscape from "../components/OnEscape";
import { useMatchSession } from "../match/MatchSessionContext";
import { useScreenNavigation } from "../navigation/ScreenNavigationContext";
import { useSoundStore } from "../state/soundStore";
import type { GameLaunch } from "../types";

function LobbyCard({
  image,
  label,
  onClick,
}: {
  image: string;
  label: string;
  onClick: () => void;
}) {
  const playSfx = useSoundStore((state) => state.playSfx);
  return (
    <button
      className="ui-lobby-card"
      type="button"
      aria-label={label}
      onClick={() => {
        playSfx("click");
        onClick();
      }}
      onMouseEnter={() => playSfx("hover")}
    >
      <span className="ui-lobby-card-shadow" aria-hidden="true" />
      <span className="ui-lobby-card-face">
        <img src={image} alt="" draggable={false} />
      </span>
    </button>
  );
}

export default function LobbyScreen({ startGame }: { startGame: (launch: GameLaunch) => void }) {
  const { navigateToScreen } = useScreenNavigation();
  const {
    status,
    phoneRoomCode,
    phoneStatus,
    createMatch,
    joinMatch,
    leaveMatch,
  } = useMatchSession();
  const playSfx = useSoundStore((state) => state.playSfx);
  const [joinCode, setJoinCode] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const transitionedRef = useRef(false);

  const activeCode = status.roomCode || "";
  const controllerUrl = useMemo(() => {
    const url = new URL("/controller", window.location.origin);
    url.searchParams.set("room", phoneRoomCode);
    return url.toString();
  }, [phoneRoomCode]);
  const hostPresent = Boolean(activeCode && (status.playerCount > 0 || status.connection === "connected"));
  const opponentPresent = status.opponentConnected;
  const hostReady = status.isHost ? phoneStatus.peerReady : status.hostReady;
  const guestReady = status.isHost ? status.guestReady : phoneStatus.peerReady;
  const bothReady = opponentPresent && hostReady && guestReady;

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(controllerUrl, {
      margin: 1,
      width: 190,
      color: { dark: "#101820", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    }).catch(() => {
      if (!cancelled) setQrDataUrl("");
    });
    return () => {
      cancelled = true;
    };
  }, [controllerUrl]);

  useEffect(() => {
    if (!bothReady || !activeCode || transitionedRef.current) return;
    transitionedRef.current = true;
    startGame({ mode: "match", roomCode: activeCode });
    navigateToScreen("GAME");
  }, [activeCode, bothReady, navigateToScreen, startGame]);

  useEffect(() => {
    if (dialogOpen) window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [dialogOpen]);

  const openJoin = useCallback(() => {
    setJoinCode("");
    setLocalError("");
    setDialogOpen(true);
  }, []);

  const host = useCallback(async () => {
    setBusy(true);
    setLocalError("");
    transitionedRef.current = false;
    try {
      await createMatch();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Unable to create lobby.");
    } finally {
      setBusy(false);
    }
  }, [createMatch]);

  const join = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setLocalError("Use the six-character lobby code.");
      return;
    }
    setBusy(true);
    setLocalError("");
    transitionedRef.current = false;
    try {
      await joinMatch(code);
      setDialogOpen(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Unable to join lobby.");
    } finally {
      setBusy(false);
    }
  }, [joinCode, joinMatch]);

  const leave = useCallback(() => {
    playSfx("back");
    leaveMatch();
    transitionedRef.current = false;
    navigateToScreen("HOME");
  }, [leaveMatch, navigateToScreen, playSfx]);

  const copyCode = useCallback(async () => {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setLocalError("Copy failed. Share the code manually.");
    }
  }, [activeCode]);

  if (activeCode) {
    return (
      <div className="ui-lobby-waiting ui-lobby-found" aria-label="Lobby found">
        <div className={"ui-lobby-slot ui-lobby-host-slot" + (hostPresent ? " is-present" : "")}>
          {hostPresent ? (
            <img
              className="ui-lobby-player-art"
              src="/ui/lobby_found/girl_vs.gif"
              alt="Lobby host present"
              draggable={false}
            />
          ) : null}
          {hostReady && (
            <img
              className="ui-lobby-ready-art"
              src="/ui/ready.png"
              alt="Host is ready"
              draggable={false}
            />
          )}
        </div>

        <div className={"ui-lobby-slot ui-lobby-opponent-slot" + (opponentPresent ? " is-present" : "")}>
          {opponentPresent ? (
            <img
              className="ui-lobby-player-art"
              src="/ui/lobby_found/versus_bg.gif"
              alt="Opponent present"
              draggable={false}
            />
          ) : null}
          {opponentPresent && guestReady && (
            <img
              className="ui-lobby-ready-art"
              src="/ui/ready.png"
              alt="Opponent is ready"
              draggable={false}
            />
          )}
        </div>

        <div className="ui-lobby-found-center">
          <p className="ui-eyebrow">LOBBY CODE</p>
          <h1 className="ui-lobby-code">{activeCode}</h1>
          <p className="ui-lobby-status" role="status">
            {status.connection === "connecting"
              ? "CONNECTING..."
              : !opponentPresent
                ? "WAITING FOR OPPONENT"
                : bothReady
                  ? "READY TO FIGHT"
              : "WAITING FOR BOTH PHONES"}
          </p>
          <div className="ui-lobby-player-count" aria-label={`Players ${status.playerCount} of 2`}>
            <span>{status.playerCount}</span><b aria-hidden="true">/</b><span>2</span>
          </div>
          <div className="ui-lobby-metrics">
            <span>PLAYERS <strong>{status.playerCount} / 2</strong></span>
            <span>ROLE <strong>{status.isHost ? "HOST" : "GUEST"}</strong></span>
            <span>PHONE <strong>{phoneStatus.peerReady ? "READY" : phoneStatus.peerConnected ? "PAIRED" : "WAITING"}</strong></span>
          </div>
          <div className="ui-lobby-actions">
            <button className="ui-primary-button" type="button" onClick={copyCode}>{copied ? "COPIED" : "COPY CODE"}</button>
            <button className="ui-secondary-button" type="button" onClick={leave}>LEAVE</button>
          </div>
        </div>

        <div className="ui-lobby-qr-panel">
          <div className="ui-lobby-qr-square">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR code for the phone controller" width={190} height={190} />
            ) : (
              <span aria-live="polite">QR</span>
            )}
          </div>
          <p>PHONE: SCAN TO READY UP</p>
          <code>{phoneRoomCode}</code>
        </div>

        {(status.error || localError) && <p className="ui-inline-error">{localError || status.error}</p>}
        <OnEscape onEscape={leave} />
      </div>
    );
  }

  return (
    <div className="ui-lobby-screen">
      <div className="ui-lobby-cards">
        <LobbyCard image="/ui/make.png" label="Make lobby" onClick={() => void host()} />
        <LobbyCard image="/ui/join.png" label="Join lobby" onClick={openJoin} />
      </div>
      {busy && <p className="ui-lobby-status">CONNECTING...</p>}
      {(status.error || localError) && <p className="ui-inline-error">{localError || status.error}</p>}

      {dialogOpen && (
        <div className="ui-dialog-backdrop" role="presentation" onMouseDown={() => setDialogOpen(false)}>
          <div className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="join-lobby-title" onMouseDown={(event) => event.stopPropagation()}>
            <h2 id="join-lobby-title" className="ui-pixel-title ui-dialog-title">ENTER LOBBY CODE</h2>
            <input
              ref={inputRef}
              className="ui-code-input"
              value={joinCode}
              onChange={(event) => {
                setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6));
                setLocalError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void join();
                if (event.key === "Escape") setDialogOpen(false);
              }}
              placeholder="ABC123"
              maxLength={6}
              autoComplete="off"
              spellCheck={false}
              aria-label="Lobby code"
            />
            <div className="ui-code-dots" aria-hidden="true">
              {Array.from({ length: 6 }, (_, index) => <span key={index} className={index < joinCode.length ? "is-filled" : ""} />)}
            </div>
            {localError && <p className="ui-inline-error">{localError}</p>}
            <button className="ui-primary-button" type="button" disabled={joinCode.length !== 6 || busy} onClick={() => void join()}>JOIN</button>
            <button className="ui-back-link" type="button" onClick={() => setDialogOpen(false)}>‹ CANCEL</button>
          </div>
        </div>
      )}
      <OnEscape onEscape={() => (dialogOpen ? setDialogOpen(false) : navigateToScreen("HOME"))} />
    </div>
  );
}
