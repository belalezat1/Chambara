/** Tunable duel constants — keep footwork magnitudes shared across outcomes. */

/** Face-to-face root spacing (shinai range, not wide sparring). */
export const PREFERRED_SPACING = 2.6;
/** Fallback if 2.6 feels tight in live play; never exceed MAX_SPACING. */
export const FALLBACK_SPACING = 2.5;
export const MAX_SPACING = 2.8;
export const SEAT_HALF_SPACING = PREFERRED_SPACING / 2;

/**
 * Intro spawn gap — outside engagement, still inside the arena rim.
 * Walk-in lerps from this to PREFERRED_SPACING after countdown.
 */
export const INTRO_OUTSIDE_SPACING = 3.4;
export const INTRO_OUTSIDE_HALF = INTRO_OUTSIDE_SPACING / 2;

export const KNOCKBACK_M = 0.28;
/** Keep pace with knockback so spacing does not open after each connect. */
export const ADVANCE_M = 0.28;
export const REGROUP_SECONDS = 0.35;
/** Hit / clash local stun (camera pull + opaque body when local is stunned). */
export const STUN_SECONDS = 1.0;
/** Blocked: attacker only; blocker stays free to retaliate. */
export const BLOCK_ATTACKER_STUN_SECONDS = 1.5;
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

/** Countdown beat length (3, 2, 1, FIGHT each hold this long). */
export const COUNTDOWN_BEAT_SECONDS = 0.7;
/** Walk from intro seats to preferred seats after FIGHT. */
export const WALK_IN_SECONDS = 0.85;
/** First to this many round wins takes the match. */
export const ROUNDS_TO_WIN = 2;

export type CombatOutcomeKind = "hit" | "clash" | "blocked" | "ringout";

/** Client-side duel phase — solo needs no Spacetime sync. */
export type MatchPhase =
  | "Idle"
  | "Intro"
  | "Countdown"
  | "WalkIn"
  | "Fighting"
  | "RoundEnd"
  | "MatchEnd";
