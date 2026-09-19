import {
  HIT_WINDOW_START,
  LUNGE_M,
  LUNGE_RECOVER_SECONDS,
  PREFERRED_SPACING,
  REGROUP_SECONDS,
  STRIKE_GAP_M,
} from "./CombatConstants.ts";

export type RootPair = { playerX: number; dummyX: number };

/**
 * Soft regroup that preserves ring-out progress: keep the defender at their
 * post-knockback X and only reseat the attacker to preferred spacing.
 */
export function regroupTargets(
  current: RootPair,
  attackerIsPlayer: boolean,
  spacing = PREFERRED_SPACING,
): RootPair {
  const defenderX = attackerIsPlayer ? current.dummyX : current.playerX;
  const attackerX = attackerIsPlayer ? current.playerX : current.dummyX;
  const toward = Math.sign(defenderX - attackerX) || 1;
  const reseatedAttacker = defenderX - toward * spacing;
  if (attackerIsPlayer) {
    return { playerX: reseatedAttacker, dummyX: defenderX };
  }
  return { playerX: defenderX, dummyX: reseatedAttacker };
}

export function stepRegroup(
  current: RootPair,
  target: RootPair,
  dt: number,
  duration = REGROUP_SECONDS,
): RootPair {
  if (duration <= 0) return target;
  const alpha = 1 - Math.exp((-1 / duration) * Math.max(0, dt) * 3);
  return {
    playerX: current.playerX + (target.playerX - current.playerX) * alpha,
    dummyX: current.dummyX + (target.dummyX - current.dummyX) * alpha,
  };
}

/** Yaw so each fighter faces the other along +X duel axis. */
export function faceYawRadians(selfX: number, otherX: number): number {
  return otherX >= selfX ? Math.PI / 2 : -Math.PI / 2;
}

/**
 * 0–1 factor for mid-slash lunge depth.
 * Ramps in through the start of the hit window, holds through mid-cut.
 */
export function lungeFactorFromSlashProgress(slashProgress: number | null): number {
  if (slashProgress === null || !Number.isFinite(slashProgress)) return 0;
  if (slashProgress <= 0) return 0;
  if (slashProgress < HIT_WINDOW_START) return slashProgress / HIT_WINDOW_START;
  return 1;
}

/** How far to step so root gap closes to STRIKE_GAP_M (capped). */
export function lungeDistanceToStrikeGap(
  originX: number,
  opponentX: number,
  targetGap = STRIKE_GAP_M,
  maxDistance = LUNGE_M,
): number {
  const gap = Math.abs(opponentX - originX);
  const needed = Math.max(0, gap - Math.max(0, targetGap));
  return Math.min(Math.max(0, maxDistance), needed);
}

/** World-X target while lunging toward the opponent from origin. */
export function lungeTargetX(
  originX: number,
  opponentX: number,
  factor: number,
  distance: number = lungeDistanceToStrikeGap(originX, opponentX),
): number {
  const dir = Math.sign(opponentX - originX) || 1;
  const t = Math.max(0, Math.min(1, factor));
  return originX + dir * distance * t;
}

/** Ease root back to origin after a missed slash. */
export function stepLungeRecover(
  currentX: number,
  originX: number,
  dt: number,
  duration = LUNGE_RECOVER_SECONDS,
): number {
  if (duration <= 0) return originX;
  const alpha = 1 - Math.exp((-1 / duration) * Math.max(0, dt) * 3);
  return currentX + (originX - currentX) * alpha;
}
