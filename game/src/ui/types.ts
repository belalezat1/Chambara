export type Screen =
  | "LOADING"
  | "TITLE"
  | "HOME"
  | "PRACTICE"
  | "LOBBY"
  | "GAME"
  | "SETTINGS";

export type GameLaunch =
  | { mode: "solo"; practice: "dummy" }
  | { mode: "match"; roomCode: string };

export type ScreenNavigationCommit = () => void;

export interface ScreenNavigationRequest {
  target: Screen;
  onCommit?: ScreenNavigationCommit;
}

export type ScreenNavigationHandler = (
  request: ScreenNavigationRequest,
) => void;
