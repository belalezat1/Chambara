import { useCallback } from "react";

import OnEscape from "../components/OnEscape";
import { useScreenNavigation } from "../navigation/ScreenNavigationContext";
import { useSoundStore } from "../state/soundStore";
import type { GameLaunch } from "../types";

export default function PracticeScreen({ startGame }: { startGame: (launch: GameLaunch) => void }) {
  const { navigateToScreen } = useScreenNavigation();
  const playSfx = useSoundStore((state) => state.playSfx);

  const startPractice = useCallback(() => {
    playSfx("click");
    startGame({ mode: "solo", practice: "dummy" });
    navigateToScreen("GAME");
  }, [navigateToScreen, playSfx, startGame]);

  return (
    <div className="ui-simple-screen">
      <div className="ui-menu-card">
        <h1 className="ui-pixel-title">PRACTICE</h1>
        <button className="ui-menu-link" type="button" onClick={startPractice} onMouseEnter={() => playSfx("hover")}>
          <span>›</span> DUMMY TRAINING
        </button>
        <p className="ui-muted-copy">Practice sword guard, blocking, and ring-out timing against the dojo dummy.</p>
      </div>
      <OnEscape onEscape={() => navigateToScreen("HOME")} />
    </div>
  );
}
