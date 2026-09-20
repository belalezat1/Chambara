import type {
  ScreenNavigationHandler,
  ScreenNavigationRequest,
  Screen,
} from "../types";

let activeHandler: ScreenNavigationHandler | null = null;
let pendingRequest: ScreenNavigationRequest | null = null;

export function registerScreenNavigation(
  handler: ScreenNavigationHandler,
): () => void {
  activeHandler = handler;
  const pending = pendingRequest;
  pendingRequest = null;
  if (pending) handler(pending);

  return () => {
    if (activeHandler === handler) activeHandler = null;
  };
}

export function requestScreen(
  target: Screen,
  onCommit?: ScreenNavigationRequest["onCommit"],
): void {
  const request = { target, onCommit } satisfies ScreenNavigationRequest;
  if (activeHandler) {
    activeHandler(request);
  } else {
    pendingRequest = request;
  }
}
