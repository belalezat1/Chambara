import { useCallback, useRef } from "react";

import OnEnter from "../components/OnEnter";
import { useScreenNavigation } from "../navigation/ScreenNavigationContext";
import { useSoundStore } from "../state/soundStore";

export default function TitleScreen() {
  const { navigateToScreen } = useScreenNavigation();
  const setSong = useSoundStore((state) => state.setSong);
  const enteredRef = useRef(false);

  const enter = useCallback(() => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    setSong("background_music.mp3");
    navigateToScreen("HOME");
  }, [navigateToScreen, setSong]);

  return (
    <button className="ui-title-screen" type="button" onClick={enter} aria-label="Start Chambara">
      <img className="ui-title-art" src="/ui/title_chambara.png" alt="Chambara" draggable={false} />
      <OnEnter onEnter={enter} />
    </button>
  );
}
