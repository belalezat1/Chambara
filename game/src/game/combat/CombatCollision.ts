/**
 * Blade-vs-body collision helpers for host combat resolution.
 * Independent of Babylon so the same math can run in tests / on the host.
 */

import {
  BLADE_HIT_RADIUS,
  BODY_CAPSULE_HALF_HEIGHT,
  BODY_CAPSULE_RADIUS,
  BODY_TORSO_Y,
  STRIKE_REACH_BONUS,
} from "./CombatConstants.ts";

const EPS = 1e-8;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BodyCapsule {
  center: Vec3;
  /** Unit axis; duel fighters use world up. */
  axis: Vec3;
  halfLength: number;
  radius: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function lengthSq(v: Vec3): number {
  return dot(v, v);
}

/** Closest-points distance² between two finite segments. */
export function distanceSquaredBetweenSegments(
  a0: Vec3,
  a1: Vec3,
  b0: Vec3,
  b1: Vec3,
): number {
  const d1 = sub(a1, a0);
  const d2 = sub(b1, b0);
  const r = sub(a0, b0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);

  if (a <= EPS && e <= EPS) return lengthSq(r);

  let s = 0;
  let t = 0;
  if (a <= EPS) {
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      if (denom > EPS) s = clamp01((b * f - c * e) / denom);
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }

  const closestA = add(a0, scale(d1, s));
  const closestB = add(b0, scale(d2, t));
  return lengthSq(sub(closestA, closestB));
}

export function segmentIntersectsCapsule(
  segmentStart: Vec3,
  segmentEnd: Vec3,
  capsule: BodyCapsule,
  padding = 0,
): boolean {
  const axisLen = Math.hypot(capsule.axis.x, capsule.axis.y, capsule.axis.z);
  const axis =
    axisLen > EPS
      ? scale(capsule.axis, 1 / axisLen)
      : { x: 0, y: 1, z: 0 };
  const half = Math.max(0, capsule.halfLength);
  const axisStart = sub(capsule.center, scale(axis, half));
  const axisEnd = add(capsule.center, scale(axis, half));
  const radius = Math.max(0, capsule.radius + padding);
  return distanceSquaredBetweenSegments(segmentStart, segmentEnd, axisStart, axisEnd) <=
    radius * radius + EPS;
}

/** Distance from a point to a finite capsule (to the medial segment). */
export function distancePointToCapsule(point: Vec3, capsule: BodyCapsule): number {
  const axisLen = Math.hypot(capsule.axis.x, capsule.axis.y, capsule.axis.z);
  const axis =
    axisLen > EPS
      ? scale(capsule.axis, 1 / axisLen)
      : { x: 0, y: 1, z: 0 };
  const half = Math.max(0, capsule.halfLength);
  const axisStart = sub(capsule.center, scale(axis, half));
  const axisEnd = add(capsule.center, scale(axis, half));
  const axisDir = sub(axisEnd, axisStart);
  const denom = lengthSq(axisDir);
  let t = 0;
  if (denom > EPS) {
    t = clamp01(dot(sub(point, axisStart), axisDir) / denom);
  }
  const closest = add(axisStart, scale(axisDir, t));
  return Math.sqrt(lengthSq(sub(point, closest)));
}

/** Vertical body capsule centered on the duel-axis seat. */
export function bodyCapsuleAtRootX(rootX: number, rootZ = 0): BodyCapsule {
  return {
    center: { x: rootX, y: BODY_TORSO_Y, z: rootZ },
    axis: { x: 0, y: 1, z: 0 },
    halfLength: BODY_CAPSULE_HALF_HEIGHT,
    radius: BODY_CAPSULE_RADIUS,
  };
}

/** Effective padding: blade thickness + Wii mid-range strike bonus. */
export function strikeHitPadding(
  bladeRadius = BLADE_HIT_RADIUS,
  reachBonus = STRIKE_REACH_BONUS,
): number {
  return bladeRadius + reachBonus;
}

/**
 * True when the blade segment or tip is within strike range of the body capsule.
 * Tip proximity covers mid-arc poses where the shaft aims away from the torso
 * but the tip has already closed along the duel axis.
 */
export function bladeHitsBody(
  bladeBase: Vec3,
  bladeTip: Vec3,
  defenderRootX: number,
  defenderRootZ = 0,
): boolean {
  const capsule = bodyCapsuleAtRootX(defenderRootX, defenderRootZ);
  const padding = strikeHitPadding();
  if (segmentIntersectsCapsule(bladeBase, bladeTip, capsule, padding)) return true;
  return distancePointToCapsule(bladeTip, capsule) <= capsule.radius + padding;
}
