import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

import ControllerScreen from "./components/ControllerScreen";
import { MotionConfig } from "motion/react";
import ScreenWipe, { WIPE_SWAP_MS, WIPE_TOTAL_MS } from "./ui/components/ScreenWipe";
import LoadingScreen from "./ui/components/LoadingScreen";
import { preloadImages } from "./ui/assetPreload";
import { MatchSessionProvider } from "./ui/match/MatchSessionContext";
import { ScreenNavigationProvider } from "./ui/navigation/ScreenNavigationContext";
import { registerScreenNavigation } from "./ui/navigation/screenNavigationBridge";
import GameScreen from "./ui/screens/GameScreen";
import HomeScreen from "./ui/screens/HomeScreen";
import LobbyScreen from "./ui/screens/LobbyScreen";
import PracticeScreen from "./ui/screens/PracticeScreen";
import SettingsScreen from "./ui/screens/SettingsScreen";
import TitleScreen from "./ui/screens/TitleScreen";
import { useSoundStore } from "./ui/state/soundStore";
import type { GameLaunch, Screen, ScreenNavigationRequest } from "./ui/types";

const UI_IMAGES = [
  "/ui/background.png",
  "/ui/background_alt.png",
  "/ui/background_square_2.png",
  "/ui/background_top_layer.png",
  "/ui/background_gray.png",
  "/ui/spellduel_bg.jpg",
  "/ui/loading_bg.png",
  "/ui/make.png",
  "/ui/join.png",
  "/ui/ready.png",
  "/ui/menu/versus_w.png",
  "/ui/menu/versus_b.png",
  "/ui/menu/practice_w.png",
  "/ui/menu/practice_b.png",
  "/ui/menu/setting_w.png",
  "/ui/menu/setting_b.png",
  "/ui/lobby_found/versus_bg.gif",
  "/ui/lobby_found/girl_vs.gif",
  "/ui/title_chambara.png"
];

const IMMEDIATE_TRANSITIONS = new Set([
  "TITLE->HOME",
  "LOBBY->GAME",
  "PRACTICE->GAME",
]);

function DesktopApp(): ReactElement {
  const [currentScreen, setCurrentScreen] = useState<Screen>("LOADING");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [screenTransition, setScreenTransition] = useState<{
    id: number;
    from: Screen;
    target: Screen;
    onCommit?: () => void;
  } | null>(null);
  const [gameLaunch, setGameLaunch] = useState<GameLaunch>({ mode: "solo", practice: "dummy" });
  const transitionActiveRef = useRef(false);
  const transitionIdRef = useRef(0);
  const previousScreenRef = useRef<Screen | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentScreenRef = useRef(currentScreen);
  currentScreenRef.current = currentScreen;

  const currentSong = useSoundStore((state) => state.currentSong);
  const musicVolume = useSoundStore((state) => state.musicVolume);
  const muted = useSoundStore((state) => state.muted);

  useEffect(() => {
    previousScreenRef.current = currentScreen;
  }, [currentScreen]);

  useEffect(() => {
    let mounted = true;
    void preloadImages(UI_IMAGES, (progress) => {
      if (mounted) setLoadingProgress(progress);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : musicVolume;
    audio.muted = muted;
    if (currentScreen !== "LOADING") void audio.play().catch(() => undefined);
  }, [currentScreen, currentSong, musicVolume, muted]);

  const setAudioRef = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    if (element) {
      element.volume = muted ? 0 : musicVolume;
      element.muted = muted;
    }
  }, [musicVolume, muted]);

  const handleNavigationRequest = useCallback((request: ScreenNavigationRequest) => {
    const from = currentScreenRef.current;
    if (request.target === from) {
      if (!transitionActiveRef.current) request.onCommit?.();
      return;
    }
    if (transitionActiveRef.current) return;

    if (IMMEDIATE_TRANSITIONS.has(`${from}->${request.target}`)) {
      request.onCommit?.();
      setCurrentScreen(request.target);
      return;
    }

    transitionActiveRef.current = true;
    setScreenTransition({
      id: ++transitionIdRef.current,
      from,
      target: request.target,
      onCommit: request.onCommit,
    });
  }, []);

  const navigateToScreen = useCallback((target: Screen, onCommit?: () => void) => {
    handleNavigationRequest({ target, onCommit });
  }, [handleNavigationRequest]);

  useEffect(() => registerScreenNavigation(handleNavigationRequest), [handleNavigationRequest]);

  useEffect(() => {
    if (!screenTransition) return;
    const swapTimer = window.setTimeout(() => {
      screenTransition.onCommit?.();
      setCurrentScreen(screenTransition.target);
    }, WIPE_SWAP_MS);
    const finishTimer = window.setTimeout(() => {
      transitionActiveRef.current = false;
      setScreenTransition(null);
    }, WIPE_TOTAL_MS);
    return () => {
      window.clearTimeout(swapTimer);
      window.clearTimeout(finishTimer);
    };
  }, [screenTransition]);

  const startGame = useCallback((launch: GameLaunch) => {
    setGameLaunch(launch);
  }, []);

  const enteredHomeFromTitle = currentScreen === "HOME" && previousScreenRef.current === "TITLE";

  const renderScreen = () => {
    switch (currentScreen) {
      case "LOADING":
        return (
          <LoadingScreen
            controlled
            progress={loadingProgress}
            statusText={loadingProgress < 100 ? "PREPARING THE DOJO..." : "READY"}
            onComplete={() => setCurrentScreen("TITLE")}
          />
        );
      case "TITLE":
        return <TitleScreen />;
      case "HOME":
        return <HomeScreen enterFromTitle={enteredHomeFromTitle} />;
      case "PRACTICE":
        return <PracticeScreen startGame={startGame} />;
      case "LOBBY":
        return <LobbyScreen startGame={startGame} />;
      case "SETTINGS":
        return <SettingsScreen />;
      case "GAME":
        return <GameScreen launch={gameLaunch} />;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="desktop-app-shell">
        <div className="desktop-app-viewport">
          <audio ref={setAudioRef} src={`/ui/music/${currentSong}`} autoPlay loop aria-hidden="true" />
          <MatchSessionProvider>
            <ScreenNavigationProvider navigateToScreen={navigateToScreen}>
              {renderScreen()}
              <ScreenWipe key={screenTransition?.id ?? "inactive"} active={screenTransition !== null} />
            </ScreenNavigationProvider>
          </MatchSessionProvider>
        </div>
      </div>
    </MotionConfig>
  );
}

export default function App(): ReactElement {
  return window.location.pathname === "/controller" ? <ControllerScreen /> : <DesktopApp />;
}
