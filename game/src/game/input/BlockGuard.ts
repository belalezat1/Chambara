export type BlockGuardPoint = { x: number; y: number };
export type BlockGuardOffsets = { lateral: number; vertical: number; forward: number };
export type BlockBladeDir = { x: number; y: number; z: number };

/**
 * Forced aim-Y while blocking so guard-angle stays lateral-only for the
 * directional block check (atan2 near ±π/2 as X sweeps).
 */
export const BLOCK_AIM_Y = 0.95;

/** Seconds to approach full block / full ready on the exp smooth. */
export const BLOCK_BLEND_SECONDS = 0.28;

/**
 * Hands near the waist; blade tip is aimed separately (up, sweeping ±90°).
 * Lateral tracks phone X across a modest arc so IK stays feasible.
 */
export function blockGuardPoseOffsets(point: BlockGuardPoint): BlockGuardOffsets {
  return {
    lateral: Math.max(-1, Math.min(1, point.x)) * 0.3,
    vertical: -0.05,
    forward: 0.1,
  };
}

/**
 * Unit blade direction for block: tip up at center, full left/right horizontal
 * at x = ±1 (180° sweep in the fighter's up/right plane — no forward bias).
 */
export function blockBladeDirection(
  right: { x: number; y: number; z: number },
  _forward: { x: number; y: number; z: number },
  guardX: number,
): BlockBladeDir {
  const x = Math.max(-1, Math.min(1, guardX));
  const angle = x * (Math.PI / 2); // -90° … +90° from vertical
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // tip = Up * cos(θ) + Right * sin(θ)
  const dx = right.x * sin;
  const dy = cos + right.y * sin;
  const dz = right.z * sin;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

/** Exp-smooth blockBlend toward 1 while blocking, else 0. */
export function approachBlockBlend(
  current: number,
  blocking: boolean,
  dt: number,
  tau = BLOCK_BLEND_SECONDS,
): number {
  const target = blocking ? 1 : 0;
  if (tau <= 0) return target;
  const alpha = 1 - Math.exp((-1 / tau) * Math.max(0, dt));
  const next = current + (target - current) * alpha;
  if (next < 0.001 && target === 0) return 0;
  if (next > 0.999 && target === 1) return 1;
  return next;
}

export function lerpGuardOffsets(
  a: BlockGuardOffsets,
  b: BlockGuardOffsets,
  t: number,
): BlockGuardOffsets {
  const u = Math.max(0, Math.min(1, t));
  return {
    lateral: a.lateral + (b.lateral - a.lateral) * u,
    vertical: a.vertical + (b.vertical - a.vertical) * u,
    forward: a.forward + (b.forward - a.forward) * u,
  };
}

/** Normalized linear blend of unit blade directions. */
export function nlerpBladeDirection(a: BlockBladeDir, b: BlockBladeDir, t: number): BlockBladeDir {
  const u = Math.max(0, Math.min(1, t));
  const dx = a.x + (b.x - a.x) * u;
  const dy = a.y + (b.y - a.y) * u;
  const dz = a.z + (b.z - a.z) * u;
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}
