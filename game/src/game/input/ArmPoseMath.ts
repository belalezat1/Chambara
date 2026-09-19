import { Vector3 } from "@babylonjs/core";

export interface ReachClampResult {
  target: Vector3;
  clamped: boolean;
  finite: boolean;
}

const EPSILON = 1e-6;

function finiteVector(value: Vector3, fallback: Vector3): Vector3 {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
    ? value.clone()
    : fallback.clone();
}

/**
 * Keeps a two-bone IK target inside a small, stable annulus. Babylon's
 * BoneIKController can produce invalid rotations when the target is exactly
 * at the shoulder or beyond the chain's maximum reach, so this is applied
 * before every runtime IK update.
 */
export function clampTwoBoneTarget(
  origin: Vector3,
  target: Vector3,
  firstLength: number,
  secondLength: number,
  minElbowBend = 0.04,
  maxElbowBend = 0.04,
): ReachClampResult {
  const safeOrigin = finiteVector(origin, Vector3.Zero());
  const safeTarget = finiteVector(target, safeOrigin.add(Vector3.Forward()));
  const offset = safeTarget.subtract(safeOrigin);
  const distance = offset.length();
  const direction = distance > EPSILON
    ? offset.scale(1 / distance)
    : Vector3.Forward();

  const first = Number.isFinite(firstLength) && firstLength > EPSILON ? firstLength : 0.4;
  const second = Number.isFinite(secondLength) && secondLength > EPSILON ? secondLength : 0.4;
  const minimum = Math.max(Math.abs(first - second) + Math.max(0, minElbowBend), EPSILON);
  const maximum = Math.max(minimum, first + second - Math.max(0, maxElbowBend));
  const safeDistance = Math.min(maximum, Math.max(minimum, distance));
  const result = safeOrigin.add(direction.scale(safeDistance));

  return {
    target: result,
    clamped: !Number.isFinite(distance) || Math.abs(safeDistance - distance) > 1e-5,
    finite: Number.isFinite(result.x) && Number.isFinite(result.y) && Number.isFinite(result.z),
  };
}
