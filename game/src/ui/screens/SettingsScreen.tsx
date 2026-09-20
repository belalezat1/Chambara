import { useCallback, useState } from "react";

import OnEscape from "../components/OnEscape";
import { useScreenNavigation } from "../navigation/ScreenNavigationContext";
import { useSoundStore } from "../state/soundStore";

export default function SettingsScreen() {
  const { navigateToScreen } = useScreenNavigation();
  const playSfx = useSoundStore((state) => state.playSfx);
  const musicVolume = useSoundStore((state) => state.musicVolume);
  const sfxVolume = useSoundStore((state) => state.sfxVolume);
  const muted = useSoundStore((state) => state.muted);
  const setMusicVolume = useSoundStore((state) => state.setMusicVolume);
  const setSfxVolume = useSoundStore((state) => state.setSfxVolume);
  const setMuted = useSoundStore((state) => state.setMuted);
  const [audioOpen, setAudioOpen] = useState(false);

  const backHome = useCallback(() => {
    playSfx("back");
    navigateToScreen("HOME");
  }, [navigateToScreen, playSfx]);

  const backToSettings = useCallback(() => {
    playSfx("back");
    setAudioOpen(false);
  }, [playSfx]);

  if (!audioOpen) {
    return (
      <div className="ui-settings-screen">
        <section className="ui-settings-menu" aria-label="Settings menu">
          <h1 className="ui-pixel-title">SETTINGS</h1>
          <button
            className="ui-menu-link ui-settings-option"
            type="button"
            onClick={() => {
              playSfx("click");
              setAudioOpen(true);
            }}
            onMouseEnter={() => playSfx("hover")}
          >
            <span aria-hidden="true">›</span> AUDIO
          </button>
        </section>
        <OnEscape onEscape={backHome} />
      </div>
    );
  }

  return (
    <div className="ui-settings-screen">
      <section className="ui-audio-menu" aria-label="Audio settings">
        <h1 className="ui-pixel-title">AUDIO</h1>
        <div className="ui-audio-panel">
          <div className="ui-settings-row">
            <label htmlFor="music-volume">MUSIC</label>
            <output>{Math.round(musicVolume * 100)}%</output>
            <input
              id="music-volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={musicVolume}
              onChange={(event) => setMusicVolume(Number(event.target.value))}
            />
          </div>
          <div className="ui-settings-row">
            <label htmlFor="sfx-volume">SFX</label>
            <output>{Math.round(sfxVolume * 100)}%</output>
            <input
              id="sfx-volume"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={sfxVolume}
              onChange={(event) => setSfxVolume(Number(event.target.value))}
            />
          </div>
          <button
            className="ui-settings-toggle"
            type="button"
            onClick={() => {
              playSfx("click");
              setMuted(!muted);
            }}
          >
            <span>MUTE</span>
            <strong className={muted ? "is-muted" : ""}>{muted ? "ON" : "OFF"}</strong>
          </button>
        </div>
        <button className="ui-back-link" type="button" onClick={backToSettings}>
          &lt; BACK
        </button>
      </section>
      <OnEscape onEscape={backToSettings} />
    </div>
  );
}
