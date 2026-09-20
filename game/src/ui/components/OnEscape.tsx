import { useEffect } from "react";

import { UI_SFX, useSoundStore } from "../state/soundStore";

export default function OnEscape({ onEscape }: { onEscape: () => void }) {
  const playSfx = useSoundStore((state) => state.playSfx);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      playSfx("back");
      onEscape();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEscape, playSfx]);

  return null;
}
