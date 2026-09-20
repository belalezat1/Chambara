import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import QRCode from "qrcode";

import ControllerScreen from "./components/ControllerScreen";
import {
  BabylonGame,
  createInitialRuntimeStatus,
  EXPECTED_ANIMATIONS,
  MOTION_SMOOTHING_ALPHA,
  POSE_STATES,
  SIMULATED_POSES,
  SIM_DT,
  WEAPON_NODE_NAMES,
  type AssetState,
  type RuntimeStatus,
} from "./game/BabylonGame";
import { MotionRelayClient } from "./game/input/MotionRelayClient";
import {
  createInitialRelayStatus,
  createRoomCode,
  type QuaternionTuple,
  type RelayStatus,
} from "./game/input/MotionTypes";
import {
  createInitialMatchStatus,
  SpacetimeMatchClient,
  type CombatOutcomeEvent,
  type MatchClientStatus,
} from "./game/net/SpacetimeMatchClient";
import type { CombatOutcomeKind } from "./game/combat/CombatConstants";
import type { MatchPhase } from "./game/combat/CombatConstants";

const SHORTCUTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "Q", "W", "E"];

type UiScreen = "title" | "menu" | "make" | "join" | "waiting" | "ready" | "duel";
type MenuFocus = "versus" | "practice" | "settings";

function playUiSfx(name: "confirm" | "cancel" | "text"): void {
  const file =
    name === "confirm"
      ? "/ui/sfx/Confirm%201.wav"
      : name === "cancel"
        ? "/ui/sfx/Cancel%201.wav"
        : "/ui/sfx/Text%201.wav";
  try {
    const audio = new Audio(file);
    void audio.play().catch(() => undefined);
  } catch {
    /* ignore */
  }
}

function initialUiScreen(): UiScreen {
  const params = new URLSearchParams(window.location.search);
  if (params.get("lab") === "1" || params.get("skipTitle") === "1") return "duel";
  return "title";
}

function stateLabel(state: AssetState): string {
  return state === "ready" ? "READY" : state === "error" ? "ERROR" : "LOADING";
}

function StateDot({ state }: { state: AssetState }): ReactElement {
  return <span className={"state-dot state-" + state} aria-hidden="true" />;
}

function relayLabel(status: RelayStatus): string {
  if (status.connection === "error") return "ERROR";
  if (status.connection === "disconnected") return "RECONNECTING";
  if (status.peerConnected) return "PHONE PAIRED";
  if (status.connection === "waiting") return "WAITING FOR PHONE";
  if (status.connection === "connected") return "RELAY CONNECTED";
  if (status.connection === "connecting") return "CONNECTING";
  return "OFFLINE";
}

function streamLabel(status: RuntimeStatus): string {
  if (status.motion.source === "simulation") return "SIMULATION";
  if (status.motion.streamState === "stale") return "STALE — HOLDING POSE";
  if (status.motion.streamState === "waiting") return "WAITING FOR RECENTER";
  if (status.motion.streamState === "live") return "LIVE";
  return "NO SAMPLE";
}

function formatQuaternion(quaternion: QuaternionTuple | null): string {
  return quaternion ? quaternion.map((value) => value.toFixed(3)).join(" / ") : "—";
}

function formatVector(vector: [number, number, number] | null): string {
  return vector ? vector.map((value) => value.toFixed(3)).join(" / ") : "-";
}

function formatCentimeters(value: number | null): string {
  return value === null ? "-" : (value * 100).toFixed(1) + " cm";
}

function formatDegrees(value: number | null): string {
  return value === null ? "-" : (value * 180 / Math.PI).toFixed(1) + "°";
}

function DesktopApp(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<BabylonGame | null>(null);
  const [status, setStatus] = useState<RuntimeStatus>(createInitialRuntimeStatus);
  const [room, setRoom] = useState(createRoomCode);
  const [relayStatus, setRelayStatus] = useState<RelayStatus>(() =>
    createInitialRelayStatus("host", room),
  );
  const [debugCamera, setDebugCamera] = useState(false);
  const [simulatedMotion, setSimulatedMotion] = useState(false);
  const [simulatedPose, setSimulatedPose] = useState<string | null>(null);
  const simulatedMotionRef = useRef(false);
  const [copyLabel, setCopyLabel] = useState("Copy controller link");
  const [matchCode, setMatchCode] = useState(createRoomCode);
  const [matchStatus, setMatchStatus] = useState<MatchClientStatus>(createInitialMatchStatus);
  const [matchEndpoint, setMatchEndpoint] = useState({ uri: "—", database: "—" });
  const [lastCombatOutcome, setLastCombatOutcome] = useState<CombatOutcomeKind | null>(null);
  const [lastMissReason, setLastMissReason] = useState<string | null>(null);
  const [combatWinnerHex, setCombatWinnerHex] = useState<string | null>(null);
  const [combatFrozen, setCombatFrozen] = useState(false);
  const [hitCount, setHitCount] = useState(0);
  const [hitFlashKey, setHitFlashKey] = useState(0);
  const [seatHud, setSeatHud] = useState({ playerX: 0, dummyX: 0 });
  const [qrDataUrl, setQrDataUrl] = useState("");
  const matchClientRef = useRef<SpacetimeMatchClient | null>(null);
  const lastHudOutcomeSeqRef = useRef(-1);
  const [uiScreen, setUiScreen] = useState<UiScreen>(initialUiScreen);
  const [menuFocus, setMenuFocus] = useState<MenuFocus>("versus");
  const [showLab, setShowLab] = useState(() => initialUiScreen() === "duel");
  const [matchPhase, setMatchPhase] = useState<MatchPhase>("Idle");
  const [countdownLabel, setCountdownLabel] = useState<string | null>(null);
  const [roundIndex, setRoundIndex] = useState(1);
  const [p1Wins, setP1Wins] = useState(0);
  const [p2Wins, setP2Wins] = useState(0);
  const [matchWinner, setMatchWinner] = useState<"p1" | "p2" | null>(null);
  const [roundBanner, setRoundBanner] = useState<string | null>(null);
  const versusModeRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let runtime: BabylonGame | null = null;
    try {
      runtime = new BabylonGame(canvas, setStatus);
      gameRef.current = runtime;
      void runtime.start().catch((error: unknown) => {
        console.error("[Chambara] Runtime failed to start", error);
      });
    } catch (error) {
      console.error("[Chambara] Babylon runtime could not initialize", error);
    }

    return () => {
      runtime?.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "BUTTON" || target?.tagName === "INPUT") return;

      const key = event.key.toUpperCase();
      if (key === "R") {
        gameRef.current?.resetPlayer();
        return;
      }
      if (key === "D") {
        setDebugCamera((current) => {
          const next = !current;
          gameRef.current?.setDebugCamera(next);
          return next;
        });
        return;
      }

      const shortcutIndex = SHORTCUTS.indexOf(key);
      if (shortcutIndex >= 0) {
        gameRef.current?.playAnimation(EXPECTED_ANIMATIONS[shortcutIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const relay = new MotionRelayClient(
      "host",
      room,
      (nextStatus) => {
        setRelayStatus(nextStatus);
        gameRef.current?.setMotionRelayStatus(nextStatus);
      },
      (sample) => {
        if (simulatedMotionRef.current) {
          simulatedMotionRef.current = false;
          gameRef.current?.setSimulatedMotion(false);
          setSimulatedMotion(false);
        }
        setSimulatedPose(null);
        gameRef.current?.setControllerState(sample);
      },
    );
    relay.start();
    return () => relay.stop();
  }, [room]);

  useEffect(() => {
    const applyCombatOutcomeToUi = (outcome: CombatOutcomeEvent) => {
      setLastCombatOutcome(outcome.kind);
      if (outcome.kind === "ringout") {
        setCombatFrozen(true);
        setCombatWinnerHex(outcome.winnerIdentityHex);
      }
    };
    const syncHitFeedbackFromGame = (game: BabylonGame) => {
      const hud = game.getCombatHud();
      setLastMissReason(hud.lastMissReason);
      setSeatHud(game.getCombatSeats());
      setMatchPhase(hud.phase);
      setCountdownLabel(hud.countdownLabel);
      setRoundIndex(hud.roundIndex);
      setP1Wins(hud.p1Wins);
      setP2Wins(hud.p2Wins);
      setMatchWinner(hud.matchWinner);
      if (hud.lastOutcomeSeq <= lastHudOutcomeSeqRef.current) return;
      lastHudOutcomeSeqRef.current = hud.lastOutcomeSeq;
      if (hud.lastOutcome) setLastCombatOutcome(hud.lastOutcome);
      if (hud.lastOutcome === "hit" || hud.lastOutcome === "ringout") {
        setHitCount((count) => count + 1);
        setHitFlashKey((key) => key + 1);
      }
      if (hud.lastOutcome === "ringout") {
        setCombatFrozen(true);
        setCombatWinnerHex(hud.winnerHex);
        const localIsWinner =
          hud.winnerHex === "local" ||
          Boolean(hud.winnerHex && hud.winnerHex === matchClientRef.current?.getStatus().identityHex);
        setRoundBanner(localIsWinner ? "ROUND WIN" : "ROUND LOST");
      }
    };
    const client = new SpacetimeMatchClient({
      onStatus: setMatchStatus,
      onRemotePose: (pose) => {
        gameRef.current?.setRemoteSwordNetworkPose(pose);
      },
      onCombatIntent: (intent) => {
        gameRef.current?.setRemoteCombatIntent(intent);
      },
      onCombatOutcome: (outcome) => {
        applyCombatOutcomeToUi(outcome);
        gameRef.current?.applyCombatOutcome(outcome);
        if (gameRef.current) syncHitFeedbackFromGame(gameRef.current);
      },
    });
    matchClientRef.current = client;
    setMatchEndpoint({ uri: client.getUri(), database: client.getDatabase() });
    const publishTimer = window.setInterval(() => {
      const game = gameRef.current;
      const match = matchClientRef.current;
      if (!game || !match) return;
      const pose = game.getLocalSwordNetworkPose();
      if (pose) match.publishPose(pose);
      const matchStatusNow = match.getStatus();
      if (matchStatusNow.opponentConnected && matchStatusNow.roomCode) {
        match.publishCombatIntent(game.getLocalCombatIntent());
        if (matchStatusNow.isHost) {
          // Resolve runs in simulationStep after tip refresh; App only publishes.
          const resolved = game.consumePendingHostCombatOutcome();
          if (resolved) {
            match.publishCombatOutcome(resolved);
            applyCombatOutcomeToUi(resolved);
            game.applyCombatOutcome(resolved);
          }
        }
      }
      // Solo dummy hits resolve inside BabylonGame.simulationStep (after lunge + tip refresh).
      syncHitFeedbackFromGame(game);
    }, 1000 / 60);
    return () => {
      window.clearInterval(publishTimer);
      client.disconnect();
      matchClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const remoteHex = matchStatus.opponentConnected
      ? matchClientRef.current?.getOpponentIdentityHex() ?? null
      : null;
    gameRef.current?.setMatchCombatSession({
      active: Boolean(matchStatus.roomCode && matchStatus.opponentConnected),
      isHost: matchStatus.isHost,
      localIdentityHex: matchStatus.identityHex,
      remoteIdentityHex: remoteHex,
    });
    if (!matchStatus.roomCode) {
      setLastCombatOutcome(null);
      setCombatWinnerHex(null);
      setCombatFrozen(false);
    }
    if (
      versusModeRef.current &&
      matchStatus.roomCode &&
      !matchStatus.opponentConnected &&
      (uiScreen === "make" || uiScreen === "join" || uiScreen === "waiting")
    ) {
      setUiScreen("waiting");
    }
    if (
      versusModeRef.current &&
      matchStatus.roomCode &&
      matchStatus.opponentConnected &&
      (uiScreen === "waiting" || uiScreen === "make" || uiScreen === "join")
    ) {
      setUiScreen("ready");
      playUiSfx("confirm");
      window.setTimeout(() => {
        setUiScreen("duel");
        setShowLab(true);
      }, 1800);
    }
  }, [
    matchStatus.roomCode,
    matchStatus.isHost,
    matchStatus.identityHex,
    matchStatus.opponentConnected,
    uiScreen,
  ]);

  useEffect(() => {
    if (uiScreen === "duel" && initialUiScreen() === "duel") {
      // Lab deep-link: start countdown once assets are up.
      const id = window.setInterval(() => {
        const game = gameRef.current;
        if (!game) return;
        if (game.getMatchPhase() === "Idle" && status.player === "ready" && status.dummy === "ready") {
          game.beginDuelSession();
          window.clearInterval(id);
        }
      }, 250);
      return () => window.clearInterval(id);
    }
    return undefined;
  }, [uiScreen, status.player, status.dummy]);

  const loadSummary = useMemo(
    () => [
      ["dojo", status.dojo],
      ["v05 manifest", status.v05Manifest],
      ["player", status.player],
      ["dummy", status.dummy],
    ] as const,
    [status.dojo, status.v05Manifest, status.player, status.dummy],
  );

  const controllerUrl = useMemo(() => {
    const url = new URL("/controller", window.location.origin);
    url.searchParams.set("room", room);
    return url.toString();
  }, [room]);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(controllerUrl, {
      margin: 1,
      width: 180,
      color: { dark: "#101820", light: "#00000000" },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    }).catch(() => {
      if (!cancelled) setQrDataUrl("");
    });
    return () => {
      cancelled = true;
    };
  }, [controllerUrl]);

  const copyControllerUrl = async () => {
    try {
      await navigator.clipboard.writeText(controllerUrl);
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Copy the URL above");
    }
    window.setTimeout(() => setCopyLabel("Copy controller link"), 1_500);
  };

  const newRoom = () => {
    setRoom(createRoomCode());
    setCopyLabel("Copy controller link");
  };

  const joinMatch = () => {
    playUiSfx("confirm");
    void matchClientRef.current?.join(matchCode);
  };

  const leaveMatch = () => {
    matchClientRef.current?.leave();
    gameRef.current?.setRemoteSwordNetworkPose(null);
    gameRef.current?.setRemoteCombatIntent(null);
    gameRef.current?.setMatchCombatSession({
      active: false,
      isHost: false,
      localIdentityHex: null,
      remoteIdentityHex: null,
    });
    setLastCombatOutcome(null);
    setCombatWinnerHex(null);
    setCombatFrozen(false);
    setHitCount(0);
    setHitFlashKey(0);
    setRoundBanner(null);
    setMatchWinner(null);
    lastHudOutcomeSeqRef.current = -1;
    versusModeRef.current = false;
  };

  const enterPractice = () => {
    playUiSfx("confirm");
    versusModeRef.current = false;
    setUiScreen("duel");
    setShowLab(true);
    setHitCount(0);
    setRoundBanner(null);
    window.setTimeout(() => gameRef.current?.beginDuelSession(), 50);
  };

  const enterVersus = () => {
    playUiSfx("confirm");
    versusModeRef.current = true;
    setUiScreen("make");
  };

  const startMakeRoom = () => {
    playUiSfx("confirm");
    const code = createRoomCode();
    setMatchCode(code);
    void matchClientRef.current?.join(code);
    setUiScreen("waiting");
  };

  const openJoinScreen = () => {
    playUiSfx("confirm");
    setUiScreen("join");
  };

  const confirmJoin = () => {
    playUiSfx("confirm");
    void matchClientRef.current?.join(matchCode);
    setUiScreen("waiting");
  };

  const newMatchCode = () => {
    setMatchCode(createRoomCode());
  };

  const toggleSimulation = () => {
    const next = !simulatedMotionRef.current;
    simulatedMotionRef.current = next;
    setSimulatedMotion(next);
    setSimulatedPose(null);
    gameRef.current?.setSimulatedMotion(next);
  };

  const selectSimulatedPose = (pose: (typeof SIMULATED_POSES)[number]) => {
    simulatedMotionRef.current = true;
    setSimulatedMotion(false);
    setSimulatedPose(pose);
    gameRef.current?.setSimulatedPose(pose);
  };

  const toggleSmoothing = () => {
    gameRef.current?.setMotionSmoothingEnabled(!status.motion.smoothingEnabled);
  };

  const usingSimulation = status.motion.source === "simulation";
  const usingPhone = status.motion.source === "phone";
  const rawDeviceQuaternion = usingSimulation || !usingPhone
    ? status.motion.rawDeviceQuaternion
    : relayStatus.rawQuaternion ?? status.motion.rawDeviceQuaternion;
  const relativeQuaternion = usingSimulation || !usingPhone
    ? status.motion.relativeQuaternion
    : relayStatus.quaternion ?? status.motion.relativeQuaternion;
  const calibrationReferenceQuaternion = usingSimulation || !usingPhone
    ? status.motion.calibrationReferenceQuaternion
    : relayStatus.calibrationReferenceQuaternion ?? status.motion.calibrationReferenceQuaternion;
  const displayedAge = usingSimulation || !usingPhone
    ? status.motion.sampleAgeMs
    : relayStatus.sampleAgeMs ?? status.motion.sampleAgeMs;
  const displayedSamples = usingSimulation || !usingPhone
    ? usingSimulation
      ? 60
      : 0
    : relayStatus.samplesPerSecond;
  const displayedSequence = usingSimulation || !usingPhone
    ? status.motion.lastSequence
    : relayStatus.lastSequence;
  const displayedSource = usingSimulation ? "SIMULATION" : usingPhone ? "PHONE" : "NONE";
  const localWon =
    combatWinnerHex === "local" ||
    Boolean(combatWinnerHex && combatWinnerHex === matchStatus.identityHex);
  const inMatch = Boolean(matchStatus.roomCode && matchStatus.opponentConnected);

  const dismissRingout = () => {
    const hud = gameRef.current?.getCombatHud();
    const matchOver = Boolean(hud?.matchWinner) || hud?.phase === "MatchEnd";

    if (matchOver) {
      if (inMatch) leaveMatch();
      else gameRef.current?.resetSoloDuel();
      setCombatFrozen(false);
      setCombatWinnerHex(null);
      setLastCombatOutcome(null);
      setLastMissReason(null);
      setHitCount(0);
      setHitFlashKey(0);
      setRoundBanner(null);
      setMatchWinner(null);
      setUiScreen("menu");
      setShowLab(false);
      lastHudOutcomeSeqRef.current = gameRef.current?.getCombatHud().lastOutcomeSeq ?? -1;
      return;
    }

    // Best-of-3 continues — next round intro.
    setCombatFrozen(false);
    setCombatWinnerHex(null);
    setLastCombatOutcome(null);
    setLastMissReason(null);
    setHitCount(0);
    setHitFlashKey(0);
    setRoundBanner(null);
    gameRef.current?.beginNextRound();
    lastHudOutcomeSeqRef.current = gameRef.current?.getCombatHud().lastOutcomeSeq ?? -1;
  };

  const inDuel = uiScreen === "duel";
  const showMenus = uiScreen !== "duel";
  const localIsP1 = !inMatch || matchStatus.isHost;
  const scoreLeft = localIsP1 ? p1Wins : p2Wins;
  const scoreRight = localIsP1 ? p2Wins : p1Wins;
  const labelLeft = localIsP1 ? "P1" : "P2";
  const labelRight = localIsP1 ? "P2" : "P1";

  return (
    <main className="app-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Chambara 3D dojo" />

      {showMenus ? (
        <div className="ui-screen-layer" aria-label="Game menus">
          {uiScreen === "title" ? (
            <button
              type="button"
              className="ui-fullbleed ui-title"
              aria-label="Start"
              onClick={() => {
                playUiSfx("confirm");
                setUiScreen("menu");
              }}
            >
              <img src="/ui/title_chambara.png" alt="Chambara" className="ui-fullbleed-img" />
            </button>
          ) : null}

          {uiScreen === "menu" ? (
            <div className="ui-fullbleed ui-menu" style={{ backgroundImage: "url(/ui/background.png)" }}>
              <div className="ui-menu-stack" role="menu">
                {(
                  [
                    ["versus", "Versus"],
                    ["practice", "Practice"],
                    ["settings", "Settings"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className="ui-menu-hit"
                    aria-label={label}
                    onMouseEnter={() => setMenuFocus(id)}
                    onFocus={() => setMenuFocus(id)}
                    onClick={() => {
                      if (id === "practice") enterPractice();
                      else if (id === "versus") enterVersus();
                      else playUiSfx("text");
                    }}
                  >
                    <img
                      src={`/ui/menu/${id}_${menuFocus === id ? "w" : "b"}.png`}
                      alt={label}
                      draggable={false}
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {uiScreen === "make" ? (
            <div className="ui-fullbleed ui-make-join">
              <img src="/ui/make.png" alt="Make room" className="ui-fullbleed-img" />
              <div className="ui-make-join-actions">
                <button type="button" className="ui-hit-zone ui-hit-primary" aria-label="Make room" onClick={startMakeRoom} />
                <button type="button" className="ui-hit-zone ui-hit-secondary" aria-label="Join instead" onClick={openJoinScreen} />
                <button
                  type="button"
                  className="ui-hit-zone ui-hit-back"
                  aria-label="Back"
                  onClick={() => {
                    playUiSfx("cancel");
                    setUiScreen("menu");
                  }}
                />
              </div>
            </div>
          ) : null}

          {uiScreen === "join" ? (
            <div className="ui-fullbleed ui-make-join">
              <img src="/ui/join.png" alt="Join room" className="ui-fullbleed-img" />
              <div className="ui-join-form">
                <input
                  aria-label="Match code"
                  value={matchCode}
                  onChange={(event) =>
                    setMatchCode(
                      event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6),
                    )
                  }
                  maxLength={6}
                  spellCheck={false}
                />
                <button type="button" className="ui-text-button" onClick={confirmJoin}>
                  Join
                </button>
                <button
                  type="button"
                  className="ui-text-button ui-text-button-ghost"
                  onClick={() => {
                    playUiSfx("cancel");
                    setUiScreen("make");
                  }}
                >
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {uiScreen === "waiting" ? (
            <div className="ui-fullbleed ui-waiting" style={{ backgroundImage: "url(/ui/background_gray.png)" }}>
              <p className="ui-waiting-code">{matchCode}</p>
              <p className="ui-waiting-copy">Waiting for opponent…</p>
              <p className="ui-waiting-note">Lobby art coming soon</p>
              <button
                type="button"
                className="ui-text-button"
                onClick={() => {
                  playUiSfx("cancel");
                  leaveMatch();
                  setUiScreen("make");
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}

          {uiScreen === "ready" ? (
            <div className="ui-fullbleed ui-ready">
              <img src="/ui/lobby_found/versus_bg.gif" alt="" className="ui-fullbleed-img" aria-hidden />
              <img src="/ui/lobby_found/girl_vs.gif" alt="Versus" className="ui-ready-vs" />
              <img src="/ui/ready.png" alt="Ready" className="ui-ready-banner" />
            </div>
          ) : null}
        </div>
      ) : null}

      {inDuel && countdownLabel ? (
        <div className="countdown-overlay" aria-live="assertive">
          <span className="countdown-digit">{countdownLabel}</span>
        </div>
      ) : null}

      {inDuel ? (
        <section className="fight-hud" aria-label="Match HUD">
          <div className="fight-hud-round">ROUND {roundIndex}</div>
          <div className="fight-hud-scores">
            <div className="fight-score">
              <span>{labelLeft}</span>
              <strong>{scoreLeft}</strong>
            </div>
            <div className="fight-score-divider">BEST OF 3</div>
            <div className="fight-score">
              <span>{labelRight}</span>
              <strong>{scoreRight}</strong>
            </div>
          </div>
          <div className="diagnostic-row fight-phase-row">
            <span>PHASE</span>
            <strong>{matchPhase.toUpperCase()}</strong>
          </div>
          {roundBanner ? <p className="fight-round-banner">{roundBanner}</p> : null}
          {matchWinner ? (
            <p className="fight-round-banner">
              MATCH {(matchWinner === "p1") === localIsP1 ? "WIN" : "LOST"}
            </p>
          ) : null}
        </section>
      ) : null}

      {combatFrozen ? (
        <div className={"ringout-celebration" + (localWon ? " ringout-win" : " ringout-lose")} role="dialog" aria-label="Ring out result">
          <div className="ringout-burst" aria-hidden="true" />
          <p className="ringout-eyebrow">{matchWinner ? "MATCH" : "RING OUT"}</p>
          <h2 className="ringout-title">
            {matchWinner
              ? localWon
                ? "YOU WIN THE MATCH"
                : "MATCH LOST"
              : localWon
                ? "YOU WIN THE ROUND"
                : "ROUND LOST"}
          </h2>
          <p className="ringout-sub">
            {localWon
              ? inMatch
                ? "You drove them past the arena rim."
                : "The dummy is out — clean consecutive connects."
              : "You were pushed past the arena rim."}
          </p>
          <p className="ringout-hits">
            SCORE · {scoreLeft} – {scoreRight} · HITS {hitCount}
          </p>
          <button className="ringout-button" type="button" onClick={dismissRingout}>
            {matchWinner ? (inMatch ? "Leave match" : "Back to menu") : "Next round"}
          </button>
        </div>
      ) : null}

      {inDuel ? (
      <section className="hud hud-top" aria-label="Prototype header">
        <div>
          <p className="eyebrow">CHAMBARA</p>
          <h1>Duel</h1>
          <p className="subtitle">Best of 3 · soft-edge ring-outs · {labelLeft} / {labelRight}</p>
        </div>
        <div className="hud-top-actions">
          <button
            type="button"
            className="small-button"
            onClick={() => setShowLab((v) => !v)}
          >
            {showLab ? "Hide lab" : "Show lab"}
          </button>
          <div className="mode-chip"><span className="pulse" /> {matchPhase.toUpperCase()}</div>
        </div>
      </section>
      ) : null}

      {inDuel && showLab ? (
      <aside className="hud inspector-panel" aria-label="Motion lab controls">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">INSPECTOR</p>
            <h2>Motion lab</h2>
          </div>
          <button className="small-button" onClick={() => {
            const next = !debugCamera;
            setDebugCamera(next);
            gameRef.current?.setDebugCamera(next);
          }}>
            {debugCamera ? "Follow camera" : "Debug orbit"}
          </button>
        </div>

        <div className="metric-grid">
          <div className="metric"><span>FPS</span><strong>{status.fps || "--"}</strong></div>
          <div className="metric"><span>SIM</span><strong>60 Hz</strong></div>
          <div className="metric"><span>TICKS</span><strong>{status.simulationTicks}</strong></div>
          <div className="metric"><span>CAMERA</span><strong>{status.cameraMode === "follow" ? "FOLLOW" : "DEBUG"}</strong></div>
        </div>

        <div className="section-block pairing-block">
          <div className="section-label">PHONE PAIRING</div>
          <div className="room-code-row">
            <strong>{room}</strong>
            <button className="small-button" onClick={newRoom}>New phone room</button>
          </div>
          {qrDataUrl ? (
            <img className="controller-qr" src={qrDataUrl} alt="QR code for phone controller URL" width={180} height={180} />
          ) : null}
          <code className="controller-url">{controllerUrl}</code>
          <button className="copy-button" onClick={copyControllerUrl}>{copyLabel}</button>
          <p className="panel-note">
            Scan the QR on your phone (same Wi-Fi). Open this desktop page via LAN IP or
            HTTPS tunnel — not localhost — so the QR is reachable. Motion prefers HTTPS.
          </p>
        </div>

        <div className="section-block pairing-block">
          <div className="section-label">LAPTOP MATCH (SPACETIME)</div>
          <div className="room-input-row">
            <input
              aria-label="Match code"
              value={matchCode}
              onChange={(event) =>
                setMatchCode(
                  event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6),
                )
              }
              maxLength={6}
              spellCheck={false}
            />
            <button className="small-button" onClick={newMatchCode}>New</button>
          </div>
          <div className="room-code-row">
            <button className="copy-button" onClick={joinMatch}>Join match</button>
            <button className="small-button" onClick={leaveMatch}>Leave</button>
          </div>
          <div className="diagnostic-row"><span>STATUS</span><strong>{matchStatus.connection.toUpperCase()}</strong></div>
          <div className="diagnostic-row"><span>PLAYERS</span><strong>{matchStatus.playerCount} / 2</strong></div>
          <div className="diagnostic-row"><span>ROLE</span><strong>{matchStatus.isHost ? "HOST" : matchStatus.roomCode ? "GUEST" : "—"}</strong></div>
          <div className="diagnostic-row"><span>OPPONENT</span><strong>{matchStatus.opponentConnected ? "SYNCED" : "WAITING"}</strong></div>
          <div className="diagnostic-row"><span>URI</span><strong className="mono-value">{matchEndpoint.uri}</strong></div>
          <div className="diagnostic-row"><span>DB</span><strong className="mono-value">{matchEndpoint.database}</strong></div>
          <div className="diagnostic-row"><span>OUTCOME</span><strong>{lastCombatOutcome ? lastCombatOutcome.toUpperCase() : "—"}</strong></div>
          <div className={`hit-feedback${hitFlashKey > 0 ? " hit-feedback-live" : ""}`}>
            <div className="hit-feedback-top">
              <span className="section-label">COLLISION</span>
              <strong className="hit-count">{hitCount}</strong>
            </div>
            <div className="hit-marker-row" aria-live="polite">
              {hitFlashKey > 0 ? (
                <div key={hitFlashKey} className="hit-marker">
                  {lastCombatOutcome === "ringout" ? "RING" : "HIT"}
                </div>
              ) : (
                <div className="hit-marker hit-marker-idle">READY</div>
              )}
            </div>
            <div className="diagnostic-row">
              <span>HITS</span>
              <strong>{hitCount}</strong>
            </div>
            <div className="diagnostic-row">
              <span>MISS</span>
              <strong>{lastMissReason ? lastMissReason.toUpperCase() : "—"}</strong>
            </div>
            <div className="diagnostic-row">
              <span>SEATS</span>
              <strong className="mono-value">
                {seatHud.playerX.toFixed(2)} / {seatHud.dummyX.toFixed(2)}
              </strong>
            </div>
            <button
              className="small-button"
              type="button"
              onClick={() => {
                setHitCount(0);
                setHitFlashKey(0);
                setLastCombatOutcome(null);
                setLastMissReason(null);
                lastHudOutcomeSeqRef.current = gameRef.current?.getCombatHud().lastOutcomeSeq ?? -1;
              }}
            >
              Reset hits
            </button>
          </div>
          {combatFrozen ? (
            <div className="diagnostic-row">
              <span>WINNER</span>
              <strong>{localWon ? "YOU" : combatWinnerHex ? "OPPONENT" : "—"}</strong>
            </div>
          ) : null}
          {matchStatus.error ? <p className="panel-note">{matchStatus.error}</p> : null}
          {combatFrozen ? (
            <p className="panel-note">
              {inMatch ? "Ring-out — leave match to reset." : "Ring-out — use Fight again on the celebration screen."}
            </p>
          ) : (
            <p className="panel-note">
              Slash lunges forward (steps back on a miss). Solo: hit the dummy anytime.
              Join a match for two-player block / clash / ring-out. Hold block on the phone.
            </p>
          )}
        </div>

        <div className="section-block circle-guard">
          <div className="section-label">SWORD GUARD · {status.motion.swordPhase.toUpperCase()}</div>
          <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="Sword guard direction, viewed from behind the player">
            <circle cx="80" cy="80" r="60" fill="none" stroke="currentColor" opacity="0.4" />
            <circle cx="80" cy="80" r="45" fill="none" stroke="#f5af55" strokeDasharray="4 5" opacity="0.45" />
            <path d="M20 80H140M80 20V140" stroke="currentColor" opacity="0.15" />
            <line x1="80" y1="80" x2={80 + status.motion.guardX * 60} y2={80 - status.motion.guardY * 60} stroke="#f5af55" strokeWidth="3" />
            <circle cx={80 + status.motion.guardX * 60} cy={80 - status.motion.guardY * 60} r="7" fill="#f5af55" />
          </svg>
          <p className="panel-note">The smaller tilt range reaches the rim faster. The upper guard lifts the hands and sword overhead. A swing registers only outside the dashed line.</p>
          <button className="small-button" disabled={!status.motion.weaponControlEnabled || status.motion.swordPhase !== "aiming"}
            onClick={() => gameRef.current?.testSlash()}>Test slash</button>
          <p className="panel-note">Without a phone, choose a simulated pose below, then Test slash.</p>
        </div>

        <div className="section-block motion-diagnostics">
          <div className="section-label">PHONE STREAM</div>
          <div className="diagnostic-row"><span>RELAY</span><strong>{relayLabel(relayStatus)}</strong></div>
          <div className="diagnostic-row"><span>STREAM</span><strong>{streamLabel(status)}</strong></div>
          <div className="diagnostic-row"><span>INPUT</span><strong>{displayedSource}</strong></div>
          <div className="diagnostic-row"><span>SAMPLES</span><strong>{displayedSamples} / SEC</strong></div>
          <div className="diagnostic-row"><span>SESSION</span><strong>{status.motion.sessionGeneration ?? "-"}</strong></div>
          <div className="diagnostic-row"><span>SEQUENCE</span><strong>{displayedSequence ?? "—"}</strong></div>
          <div className="diagnostic-row"><span>AGE</span><strong>{displayedAge === null ? "—" : displayedAge + " ms"}</strong></div>
          <div className="diagnostic-row"><span>CALIBRATED</span><strong>{status.motion.calibrated ? "YES" : "NO"}</strong></div>
          <div className="diagnostic-row"><span>WEAPON CONTROL</span><strong>{status.motion.weaponControlEnabled ? "ENABLED" : "HOLDING"}</strong></div>
          <div className="diagnostic-row"><span>NODE</span><strong>{status.motion.controlNode}</strong></div>
          <div className="diagnostic-row"><span>V05 HIERARCHY</span><strong>{status.motion.weaponMarkersStable ? "VALID" : "CHECK"}</strong></div>
          <div className="diagnostic-row"><span>PRIMARY / SECONDARY MARKERS</span><strong>{status.motion.primaryGripSource} / {status.motion.secondaryGripSource}</strong></div>
          <div className="diagnostic-row"><span>POSE STATE</span><strong>{status.motion.poseState} → {status.motion.targetPoseState}</strong></div>
          <div className="diagnostic-row"><span>REACH FRACTION / SHELL</span><strong>{status.motion.reachFraction.toFixed(3)} / {formatCentimeters(status.motion.reachShellRadiusMeters)}</strong></div>
          <div className="diagnostic-row"><span>GRIP SPACING / BLADE</span><strong>{formatCentimeters(status.motion.weaponGeometryGripSpacingMeters)} / {formatCentimeters(status.motion.weaponGeometryBladeLengthMeters)}</strong></div>
          <div className="diagnostic-row"><span>ARM MAX REACH R / L</span><strong>{formatCentimeters(status.motion.rightArmMaxReachMeters)} / {formatCentimeters(status.motion.leftArmMaxReachMeters)}</strong></div>
          <div className="diagnostic-row"><span>TWO-ARM FEASIBILITY</span><strong>{status.motion.twoArmFeasible ? "YES" : "ADJUSTING"}{status.motion.reachAdjusted ? " · GRIP ADJUSTED" : ""}</strong></div>
          <div className="quaternion-row"><span>REACH CENTER ROOT / WORLD</span><code>{formatVector(status.motion.reachCenterRootLocal)} → {formatVector(status.motion.reachCenterWorld)}</code></div>
          <div className="quaternion-row"><span>REST SHOULDERS ROOT R / L</span><code>{formatVector(status.motion.rightShoulderRestRoot)} → {formatVector(status.motion.leftShoulderRestRoot)}</code></div>
          <div className="diagnostic-row"><span>REST SHOULDER SOURCE</span><strong>{status.motion.shoulderAnchorSource?.toUpperCase() ?? "-"}</strong></div>
          <div className="quaternion-row"><span>CAPTURED SHOULDERS ROOT R / L</span><code>{formatVector(status.motion.rightShoulderRestCaptureRoot)} → {formatVector(status.motion.leftShoulderRestCaptureRoot)}</code></div>
          <div className="diagnostic-row"><span>ANCHOR DELTA R / L</span><strong>{formatCentimeters(status.motion.rightShoulderAnchorErrorMeters)} / {formatCentimeters(status.motion.leftShoulderAnchorErrorMeters)}</strong></div>
          <div className="diagnostic-row"><span>TORSO FOLLOW</span><strong>{status.motion.torsoFollowEnabled ? "ON" : "OFF"}</strong></div>
          <div className="diagnostic-row"><span>FOLLOW YAW / PITCH</span><strong>{formatDegrees(status.motion.torsoFollowYawRadians)} / {formatDegrees(status.motion.torsoFollowPitchRadians)}</strong></div>
          <div className="diagnostic-row"><span>FOLLOW DELTA / DRIFT</span><strong>{formatDegrees(status.motion.torsoFollowDeltaRadians)} / {formatDegrees(status.motion.torsoFollowDriftRadians)}</strong></div>
          <div className="diagnostic-row"><span>TARGET SOURCE</span><strong>{status.motion.weaponTargetSource?.toUpperCase() ?? "-"}</strong></div>
          <div className="diagnostic-row"><span>TARGET SESSION</span><strong>{status.motion.weaponTargetSessionGeneration ?? "-"}</strong></div>
          <div className="diagnostic-row"><span>TARGET SEQUENCE</span><strong>{status.motion.weaponTargetSequence ?? "-"}</strong></div>
          <div className="diagnostic-row"><span>IK CLAMPED</span><strong>{status.motion.ikClamped ? "YES" : "NO"}</strong></div>
          <div className="diagnostic-row"><span>IK R / L</span><strong>{status.motion.rightIkClamped ? "CLAMP" : "OK"} / {status.motion.leftIkClamped ? "CLAMP" : "OK"}</strong></div>
          <div className="diagnostic-row"><span>IK FINITE</span><strong>{status.motion.ikFinite ? "YES" : "NO"}</strong></div>
          <div className="diagnostic-row"><span>GRIP ERROR R / L</span><strong>{formatCentimeters(status.motion.rightGripErrorMeters)} / {formatCentimeters(status.motion.leftGripErrorMeters)}</strong></div>
          <div className="diagnostic-row"><span>HAND CONTACT LOCAL R / L</span><strong>{formatCentimeters(status.motion.rightHandContactLocalMeters)} / {formatCentimeters(status.motion.leftHandContactLocalMeters)}</strong></div>
          <div className="diagnostic-row"><span>CONTACT THRESHOLD</span><strong>{formatCentimeters(status.motion.gripErrorThresholdMeters)}</strong></div>
          <div className="quaternion-row"><span>RAW ABSOLUTE DEVICE QUATERNION</span><code>{formatQuaternion(rawDeviceQuaternion)}</code></div>
          <div className="quaternion-row"><span>CALIBRATION REFERENCE</span><code>{formatQuaternion(calibrationReferenceQuaternion)}</code></div>
          <div className="quaternion-row"><span>RELATIVE DEVICE QUATERNION</span><code>{formatQuaternion(relativeQuaternion)}</code></div>
          <div className="quaternion-row"><span>MAPPED GAME DELTA</span><code>{formatQuaternion(status.motion.mappedGameQuaternion)}</code></div>
          <div className="quaternion-row"><span>PHONE â†’ GAME FRAME ALIGNMENT</span><code>{formatQuaternion(status.motion.phoneToGameplayBasisQuaternion)}</code></div>
          <div className="quaternion-row"><span>GAMEPLAY BLADE FORWARD</span><code>{formatVector(status.motion.gameplaySwordForward)}</code></div>
          <div className="quaternion-row"><span>GAMEPLAY BLADE UP</span><code>{formatVector(status.motion.gameplaySwordUp)}</code></div>
          <div className="quaternion-row"><span>ACTUAL MARKER BLADE FORWARD</span><code>{formatVector(status.motion.visibleShinaiForward)}</code></div>
          <div className="diagnostic-row"><span>GAMEPLAY / VISIBLE FORWARD DOT</span><strong>{status.motion.gameplayVisibleForwardDot === null ? "-" : status.motion.gameplayVisibleForwardDot.toFixed(3)}</strong></div>
          <div className="quaternion-row"><span>FINAL VISIBLE SHINAI ROTATION</span><code>{formatQuaternion(status.motion.weaponQuaternion)}</code></div>
          <div className="quaternion-row"><span>GAMEPLAY TARGET ROTATION</span><code>{formatQuaternion(status.motion.gameplayWeaponQuaternion)}</code></div>
          <div className="quaternion-row"><span>GAMEPLAY NEUTRAL SWORD ROTATION</span><code>{formatQuaternion(status.motion.neutralWeaponQuaternion)}</code></div>
          <div className="quaternion-row"><span>VISIBLE NEUTRAL SHINAI ROTATION</span><code>{formatQuaternion(status.motion.visibleNeutralWeaponQuaternion)}</code></div>
          <div className="quaternion-row"><span>ASSET FRAME CORRECTION</span><code>{formatQuaternion(status.motion.assetFrameCorrectionQuaternion)}</code></div>
          <div className="quaternion-row"><span>MARKER BLADE FORWARD FRAME</span><code>{formatVector(status.motion.bladeForwardInPrimaryFrame)}</code></div>
          <div className="quaternion-row"><span>MARKER BLADE UP FRAME</span><code>{formatVector(status.motion.bladeUpInPrimaryFrame)}</code></div>
          <div className="quaternion-row"><span>AUTHORITATIVE TARGET WORLD ROTATION</span><code>{formatQuaternion(status.motion.weaponTargetQuaternion)}</code></div>
          <div className="quaternion-row"><span>TARGET ROOT GRIP ANCHOR</span><code>{formatVector(status.motion.weaponTargetRootAnchor)}</code></div>
          <div className="quaternion-row"><span>TARGET WORLD GRIP</span><code>{formatVector(status.motion.weaponTargetPosition)}</code></div>
          <div className="quaternion-row"><span>TARGET BASE / TIP</span><code>{formatVector(status.motion.weaponTargetBase)} → {formatVector(status.motion.weaponTargetTip)}</code></div>
          <div className="quaternion-row"><span>PRIMARY / SECONDARY TARGET</span><code>{formatVector(status.motion.primaryHandTarget)} → {formatVector(status.motion.secondaryHandTarget)}</code></div>
          <div className="quaternion-row"><span>RIGHT / LEFT HAND CONTACT</span><code>{formatVector(status.motion.rightHandContact)} → {formatVector(status.motion.leftHandContact)}</code></div>
          <p className="panel-note physical-test-note">
            Physical test: hold the phone flat with the screen facing UP, top
            edge pointing directly at the monitor/opponent, and bottom edge
            toward you. Keep it roughly level, tap RECENTER, then test up,
            down, left, right, diagonals. Swing to cut across the circle.
          </p>
          {relayStatus.error && <p className="panel-error">{relayStatus.error}</p>}
        </div>

        <div className="section-block input-tools">
          <div className="section-label">INPUT TOOLS</div>
          <div className="tool-row">
            <button className={"small-button " + (simulatedMotion ? "selected-tool" : "")} onClick={toggleSimulation}>
              {simulatedMotion ? "Stop simulated motion" : "Simulated motion"}
            </button>
            <button className="small-button" onClick={toggleSmoothing}>
              {status.motion.smoothingEnabled ? "Use raw" : "Use smoothed"}
            </button>
          </div>
          <div className="tool-row">
            <button
              className={"small-button " + (status.motion.torsoFollowEnabled ? "selected-tool" : "")}
              onClick={() => gameRef.current?.setTorsoFollowEnabled(!status.motion.torsoFollowEnabled)}
            >
              Torso follow {status.motion.torsoFollowEnabled ? "ON" : "OFF"}
            </button>
          </div>
          <p className="panel-note">
            {status.motion.smoothingEnabled
              ? "Quaternion slerp: " + MOTION_SMOOTHING_ALPHA.toFixed(2) + " per 60 Hz tick."
              : "Raw quaternion target: no presentation smoothing."}
          </p>
          <div className="section-label pose-label">SIMULATED POSES</div>
          <div className="pose-grid">
            {SIMULATED_POSES.map((pose) => (
              <button
                className={"small-button " + (simulatedPose === pose ? "selected-tool" : "")}
                key={pose}
                onClick={() => selectSimulatedPose(pose)}
              >
                {pose}
              </button>
            ))}
          </div>
          <div className="section-label pose-label">REACH STATES (AUTOMATIC DURING CIRCLE CONTROL)</div>
          <div className="pose-grid">
            {POSE_STATES.map((state) => (
              <button
                className={"small-button " + (status.motion.targetPoseState === state ? "selected-tool" : "")}
                key={state}
                disabled={status.motion.weaponControlEnabled}
                onClick={() => gameRef.current?.setReachState(state)}
              >
                {state}
              </button>
            ))}
          </div>
          <div className="tool-row debug-tools">
            <button
              className={"small-button " + (status.motion.showWeaponDebug ? "selected-tool" : "")}
              onClick={() => gameRef.current?.setWeaponDebugVisibility(!status.motion.showWeaponDebug)}
            >
              {status.motion.showWeaponDebug ? "Hide weapon debug" : "Show weapon debug"}
            </button>
            <button
              className={"small-button " + (status.motion.showIkDebug ? "selected-tool" : "")}
              onClick={() => gameRef.current?.setIkDebugVisibility(!status.motion.showIkDebug)}
            >
              {status.motion.showIkDebug ? "Hide IK debug" : "Show IK debug"}
            </button>
          </div>
        </div>

        <div className="section-block">
          <div className="section-label">ASSET LOAD</div>
          <div className="asset-list">
            {loadSummary.map(([name, state]) => (
              <div className="asset-row" key={name}>
                <span><StateDot state={state} /> {name}</span>
                <span className={"text-" + state}>{stateLabel(state)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="section-block active-motion">
          <div className="section-label">CURRENT MOTION</div>
          <div className="motion-row"><span>PLAYER</span><strong>{status.currentPlayerAnimation}</strong></div>
          <div className="motion-row"><span>DUMMY</span><strong>{status.currentDummyAnimation}</strong></div>
        </div>

        <div className="section-block">
          <div className="section-label">PLAY PLAYER CLIP</div>
          <div className="clip-grid">
            {EXPECTED_ANIMATIONS.map((name, index) => (
              <button
                className={"clip-button " + (status.currentPlayerAnimation === name ? "selected" : "")}
                key={name}
                onClick={() => gameRef.current?.playAnimation(name)}
                title={"Play " + name + " (" + SHORTCUTS[index] + ")"}
              >
                <span className="clip-key">{SHORTCUTS[index]}</span>{name}
              </button>
            ))}
          </div>
          <button className="reset-button" onClick={() => gameRef.current?.resetPlayer()}>
            Reset to CombatIdle <span>R</span>
          </button>
        </div>

        <div className="section-block">
          <div className="section-label">WEAPON HIERARCHY</div>
          <div className="node-list">
            {WEAPON_NODE_NAMES.map((name) => (
              <div className="node-row" key={name}>
                <span className={status.weaponNodes[name] ? "node-found" : "node-missing"}>{status.weaponNodes[name] ? "●" : "○"}</span>
                <code>{name}</code>
                <span>{status.weaponNodes[name] ? "FOUND" : "MISSING"}</span>
              </div>
            ))}
          </div>
        </div>

        {status.errors.length > 0 && (
          <div className="error-block" role="alert">
            <div className="section-label">RUNTIME ERRORS</div>
            {status.errors.map((error) => <p key={error}>{error}</p>)}
          </div>
        )}
      </aside>
      ) : null}

      {inDuel ? (
      <footer className="hud footer-note">
        <span>Fixed simulation: {SIM_DT.toFixed(5)} s step</span>
        <span>Phone URL: /controller?room={room} · Keys 1–0, Q, W play clips · R resets · D toggles camera</span>
      </footer>
      ) : null}
    </main>
  );
}

export default function App(): ReactElement {
  return window.location.pathname === "/controller"
    ? <ControllerScreen />
    : <DesktopApp />;
}
