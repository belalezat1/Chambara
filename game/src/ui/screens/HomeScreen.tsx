import { useCallback } from "react";

import ErrorBanner from "../components/ErrorBanner";
import HomeMenu from "../components/HomeMenu";
import { useScreenNavigation } from "../navigation/ScreenNavigationContext";
import { useMatchSession } from "../match/MatchSessionContext";
import { useSoundStore } from "../state/soundStore";

export default function HomeScreen({ enterFromTitle }: { enterFromTitle: boolean }) {
  const { navigateToScreen } = useScreenNavigation();
  const playSfx = useSoundStore((state) => state.playSfx);
  const { status } = useMatchSession();

  const go = useCallback((target: "LOBBY" | "PRACTICE" | "SETTINGS") => {
    playSfx("click");
    navigateToScreen(target);
  }, [navigateToScreen, playSfx]);

  return (
    <div className="ui-screen ui-home-screen">
      <HomeMenu
        onVersus={() => go("LOBBY")}
        onPractice={() => go("PRACTICE")}
        onSettings={() => go("SETTINGS")}
        onHover={() => playSfx("hover")}
        enterFromTitle={enterFromTitle}
      />
      <ErrorBanner message={status.error || "Something unexpected happened"} visible={Boolean(status.error)} />
    </div>
  );
}
