import { create } from "zustand";
import { persist } from "zustand/middleware";

export const UI_SFX = {
  hover: "Text 1.wav",
  click: "Confirm 1.wav",
  back: "Cancel 1.wav",
} as const;

type SfxKind = keyof typeof UI_SFX;

export interface SoundStore {
  currentSong: string;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  setSong: (song: string) => void;
  setMusicVolume: (volume: number) => void;
  setSfxVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  playSfx: (kind: SfxKind) => void;
}

const clampVolume = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export const useSoundStore = create<SoundStore>()(
  persist(
    (set, get) => ({
      currentSong: "background_music.mp3",
      musicVolume: 0.5,
      sfxVolume: 0.5,
      muted: false,
      setSong: (song) => set({ currentSong: song }),
      setMusicVolume: (volume) => set({ musicVolume: clampVolume(volume) }),
      setSfxVolume: (volume) => set({ sfxVolume: clampVolume(volume) }),
      setMuted: (muted) => set({ muted }),
      playSfx: (kind) => {
        const { muted, sfxVolume } = get();
        if (muted || sfxVolume <= 0) return;
        const audio = new Audio(`/ui/sfx/${encodeURIComponent(UI_SFX[kind])}`);
        audio.volume = clampVolume(sfxVolume);
        void audio.play().catch(() => undefined);
      },
    }),
    {
      name: "chambara-sound-settings",
      partialize: ({ currentSong, musicVolume, sfxVolume, muted }) => ({
        currentSong,
        musicVolume,
        sfxVolume,
        muted,
      }),
    },
  ),
);
