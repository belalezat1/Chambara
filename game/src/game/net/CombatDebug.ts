const DEBUG_STORAGE_KEY = "chambara.combat.debug";

function debugEnabled(): boolean {
  const configured = (import.meta.env.VITE_COMBAT_DEBUG as string | undefined)?.trim();
  if (configured === "1" || configured === "true") return true;
  if (configured === "0" || configured === "false") return false;
  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Event-level multiplayer combat diagnostics. Disable with VITE_COMBAT_DEBUG=0. */
export function combatDebug(event: string, details?: Record<string, unknown>): void {
  if (!debugEnabled()) return;
  if (details) {
    // Serialize eagerly so copied console logs retain their diagnostic values.
    console.info(`[Chambara:combat] ${event} ${JSON.stringify(details)}`);
  } else {
    console.info(`[Chambara:combat] ${event}`);
  }
}

export function shortIdentity(identity: string | null): string | null {
  return identity ? identity.slice(0, 8) : null;
}
