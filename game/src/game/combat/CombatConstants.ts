/** Tunable duel constants — keep footwork magnitudes shared across outcomes. */

/** Face-to-face root spacing (shinai range, not wide sparring). */
export const PREFERRED_SPACING = 2.2;
export const SEAT_HALF_SPACING = PREFERRED_SPACING / 2;

export const KNOCKBACK_M = 0.28;
/** Keep pace with knockback so spacing does not open after each connect. */
export const ADVANCE_M = 0.28;
export const REGROUP_SECONDS = 0.35;
/** Hit / clash local stun (slash lock). */
export const STUN_SECONDS = 0.5;
/**
 * Blocked: attacker only — long enough for the blocker to retaliate.
 * Blocker must never receive this stun.
 */
export const BLOCK_ATTACKER_STUN_SECONDS = 2.5;
/** Post-hit i-frames (ms) — short enough to chain connects, long enough to stop same-swing spam. */
export const HIT_INVULN_MS = 150;

export const ARENA_RADIUS = 3.6;

export const BLOCK_ANGLE_DEG = 35;
export const CLASH_BLADE_DIST = 0.35;

/** Hit / clash window as fraction of the slash cut. */
export const HIT_WINDOW_START = 0.15;
export const HIT_WINDOW_END = 0.8;

/**
 * Body hit volume (vertical capsule on the duel seat).
 * Tuned to Baizhong standing height; not a Babylon physics collider.
 */
export const BODY_TORSO_Y = 1.1;
export const BODY_CAPSULE_RADIUS = 0.38;
export const BODY_CAPSULE_HALF_HEIGHT = 0.78;
export const BLADE_HIT_RADIUS = 0.06;
/**
 * Tip/shaft padding — forgiving enough for live tip lag, still no seat fallback.
 */
export const STRIKE_REACH_BONUS = 0.9;

/** @deprecated Prefer blade-vs-body capsule; kept for diagnostics. */
export const REACH_HIT_DIST =
  BODY_CAPSULE_RADIUS + BLADE_HIT_RADIUS + STRIKE_REACH_BONUS;

/**
 * Mid-slash close: step so root gap ≈ STRIKE_GAP_M, capped by LUNGE_M.
 */
export const STRIKE_GAP_M = 1.25;
export const LUNGE_M = 0.95;
export const LUNGE_RECOVER_SECONDS = 0.22;

export type CombatOutcomeKind = "hit" | "clash" | "blocked" | "ringout";
