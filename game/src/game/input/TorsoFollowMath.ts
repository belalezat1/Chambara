import { Quaternion, Vector3 } from "@babylonjs/core";

const EPSILON = 1e-8;

function finiteQuaternion(value: Quaternion): Quaternion {
  return [value.x, value.y, value.z, value.w].every(Number.isFinite)
    ? value.clone().normalize()
    : Quaternion.Identity();
}

/**
 * Applies a procedural torso/shoulder delta to an animation-pose rotation.
 * The base rotation is always the current animation sample, never the prior
 * rendered result, so repeated frames cannot accumulate drift.
 */
export function composeTorsoFollowRotation(
  baseRotation: Quaternion,
  yaw: number,
  pitch: number,
  yawWeight: number,
  pitchWeight: number,
  pitchAxis: Vector3,
  enabled = true,
): Quaternion {
  const base = finiteQuaternion(baseRotation);
  if (!enabled) return base;

  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  const safePitch = Number.isFinite(pitch) ? pitch : 0;
  const axis = pitchAxis.clone();
  if (!Number.isFinite(axis.x) || !Number.isFinite(axis.y) || !Number.isFinite(axis.z) || axis.length() < EPSILON) {
    axis.copyFrom(Vector3.Right());
  } else {
    axis.normalize();
  }
  const delta = Quaternion.RotationAxis(Vector3.Up(), safeYaw * yawWeight)
    .multiply(Quaternion.RotationAxis(axis, safePitch * pitchWeight))
    .normalize();
  return delta.multiply(base).normalize();
}

/** Returns the shortest angular distance between two normalized rotations. */
export function quaternionAngularDistance(first: Quaternion, second: Quaternion): number {
  const a = finiteQuaternion(first);
  const b = finiteQuaternion(second);
  const dot = Math.max(-1, Math.min(1, Math.abs(
    a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w,
  )));
  return 2 * Math.acos(dot);
}
