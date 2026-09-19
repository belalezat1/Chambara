import { Quaternion, Vector3 } from "@babylonjs/core";

import type { QuaternionTuple } from "./MotionTypes";

const DEGREES_TO_RADIANS = Math.PI / 180;
const AXIS_EPSILON = 1e-8;

export const SIMULATED_POSE_NAMES = [
  "neutral",
  "up",
  "down",
  "left",
  "right",
  "rollLeft",
  "rollRight",
  "diagonalLeft",
  "diagonalRight",
] as const;

export type SimulatedPoseName = (typeof SIMULATED_POSE_NAMES)[number];

/**
 * The phone controller frame is the physical screen-up neutral frame:
 *
 *   phone +X = right edge
 *   phone +Y = top edge / controller forward
 *   phone +Z = screen normal / controller up
 *
 * The gameplay frame is supplied from the marker-derived BladeTip/BladeUp
 * frame at runtime. The alignment is a proper quaternion frame change, not a
 * per-frame Euler sign hack.
 */
export interface OrthonormalFrame {
  right: Vector3;
  forward: Vector3;
  up: Vector3;
}

function normalizedVector(value: Vector3, fallback: Vector3): Vector3 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    return fallback.clone().normalize();
  }
  const length = value.length();
  return length > AXIS_EPSILON ? value.clone().scale(1 / length) : fallback.clone().normalize();
}

/** Builds a finite, orthonormal, right-handed frame from forward and up. */
export function orthonormalFrame(
  forwardInput: Vector3,
  upHintInput: Vector3,
): OrthonormalFrame {
  const forward = normalizedVector(forwardInput, Vector3.Forward());
  let upHint = normalizedVector(upHintInput, Vector3.Up());
  upHint = upHint.subtract(forward.scale(Vector3.Dot(upHint, forward)));
  if (upHint.length() <= AXIS_EPSILON) {
    const fallback = Math.abs(Vector3.Dot(forward, Vector3.Up())) < 0.95
      ? Vector3.Up()
      : Vector3.Right();
    upHint = fallback.subtract(forward.scale(Vector3.Dot(fallback, forward)));
  }
  const up = normalizedVector(upHint, Vector3.Up());
  const right = normalizedVector(Vector3.Cross(forward, up), Vector3.Right());
  const correctedUp = normalizedVector(Vector3.Cross(right, forward), up);
  return { right, forward, up: correctedUp };
}

/** Converts a frame's right/forward/up axes into a proper quaternion. */
export function quaternionFromFrame(frame: OrthonormalFrame): Quaternion {
  const normalized = orthonormalFrame(frame.forward, frame.up);
  return Quaternion.RotationQuaternionFromAxis(
    normalized.right,
    normalized.forward,
    normalized.up,
  ).normalize();
}

/** Returns the proper rotation that maps one frame into another frame. */
export function frameAlignmentQuaternion(
  fromFrame: OrthonormalFrame,
  toFrame: OrthonormalFrame,
): Quaternion {
  return quaternionFromFrame(toFrame)
    .multiply(quaternionFromFrame(fromFrame).invert())
    .normalize();
}

export const GAMEPLAY_BLADE_FORWARD_AXIS = new Vector3(0, 1, 0);
/** Default marker-derived up reference before the runtime asset transform. */
export const GAMEPLAY_BLADE_UP_AXIS = new Vector3(0, 0, 1);
export const GAMEPLAY_BLADE_RIGHT_AXIS = new Vector3(1, 0, 0);
export const PHONE_RIGHT_EDGE_AXIS = new Vector3(1, 0, 0);
export const PHONE_TOP_EDGE_AXIS = new Vector3(0, 1, 0);
export const PHONE_SCREEN_NORMAL_AXIS = new Vector3(0, 0, 1);
export const PHONE_CONTROLLER_FRAME: OrthonormalFrame = {
  right: PHONE_RIGHT_EDGE_AXIS.clone(),
  forward: PHONE_TOP_EDGE_AXIS.clone(),
  up: PHONE_SCREEN_NORMAL_AXIS.clone(),
};

/**
 * Physical Android frame correction for the screen-up controller pose.
 *
 * The observed physical frame has the top-edge and screen-normal rotation
 * signs reversed while the right-edge rotation is correct. A single proper
 * half-turn around the phone right edge produces exactly that axis mapping:
 * X -> X, Y -> -Y, Z -> -Z.
 */
export const PHYSICAL_CONTROLLER_FRAME_CORRECTION = Quaternion.RotationAxis(
  PHONE_RIGHT_EDGE_AXIS,
  Math.PI,
).normalize();

/**
 * Matches Three.js Euler(beta, gamma, alpha, "ZXY") using Babylon's
 * quaternion multiplication order: qZ * qX * qY.
 */
export function zxyEulerToQuaternion(
  alpha: number,
  beta: number,
  gamma: number,
): Quaternion {
  const x = beta * DEGREES_TO_RADIANS * 0.5;
  const y = gamma * DEGREES_TO_RADIANS * 0.5;
  const z = alpha * DEGREES_TO_RADIANS * 0.5;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);

  return new Quaternion(
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ).normalize();
}

/**
 * Returns the explicit screen-orientation correction used after sensor
 * composition. Keeping it separate makes the ZXY sensor math testable on
 * its own and makes the display rotation convention visible at the callsite.
 */
export function screenOrientationCorrection(screenAngle = 0): Quaternion {
  if (!Number.isFinite(screenAngle) || Math.abs(screenAngle) < 0.001) {
    return Quaternion.Identity();
  }

  return Quaternion.RotationAxis(
    new Vector3(0, 0, 1),
    -screenAngle * DEGREES_TO_RADIANS,
  ).normalize();
}

/**
 * Matches the Device Orientation spec's intrinsic Z-X'-Y'' order used by
 * the reference motion_test controller, then applies the display correction.
 */
export function deviceOrientationToQuaternion(
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle = 0,
): Quaternion {
  // This is a browser/display-frame correction only. It is constant during a
  // calibration session and therefore cancels out of the relative quaternion.
  return screenOrientationCorrection(screenAngle)
    .multiply(zxyEulerToQuaternion(alpha, beta, gamma))
    .normalize();
}

/**
 * Derives the fixed phone-controller -> gameplay-frame alignment.
 *
 * `neutralWeaponRotation * gameplayFrame` is the marker-derived weapon frame
 * in world space at neutral. The phone neutral frame is derived from the
 * fighter forward and world up. Their difference is the only fixed transform
 * needed to express a body-fixed phone delta in weapon-local coordinates.
 */
export function derivePhoneToGameplayBasis(
  neutralWeaponRotation: Quaternion,
  gameplayFrame: OrthonormalFrame,
  playerForward: Vector3,
  worldUp = Vector3.Up(),
): Quaternion {
  const phoneNeutralWorld = frameAlignmentQuaternion(
    PHONE_CONTROLLER_FRAME,
    orthonormalFrame(playerForward, worldUp),
  );
  const gameplayNeutralWorld = neutralWeaponRotation
    .clone()
    .multiply(quaternionFromFrame(gameplayFrame))
    .normalize();
  // Compose the physical controller correction into the fixed alignment. The
  // resulting basis is B_corrected = B * C; all per-frame input remains a
  // single full-quaternion conjugation.
  return gameplayNeutralWorld
    .clone()
    .invert()
    .multiply(phoneNeutralWorld)
    .multiply(PHYSICAL_CONTROLLER_FRAME_CORRECTION)
    .normalize();
}

/**
 * Default fixed alignment for the canonical v05 frame. Babylon's neutral
 * ready frame is [lateral, forward, down], and the physical controller frame
 * correction is included in this single proper quaternion alignment.
 */
export const PHONE_TO_GAME_BASIS = derivePhoneToGameplayBasis(
  neutralSwordRotation(new Vector3(1, 0, 0)),
  {
    right: GAMEPLAY_BLADE_RIGHT_AXIS,
    forward: GAMEPLAY_BLADE_FORWARD_AXIS,
    up: GAMEPLAY_BLADE_UP_AXIS,
  },
  new Vector3(1, 0, 0),
);

/** Convert a calibrated phone delta into the game's sword-control basis. */
export function phoneDeltaToGameDelta(
  phoneDelta: Quaternion,
  phoneToGameBasis = PHONE_TO_GAME_BASIS,
): Quaternion {
  const basis = phoneToGameBasis.clone().normalize();
  const inverseBasis = basis.clone().invert();
  return basis
    .multiply(phoneDelta.clone().normalize())
    .multiply(inverseBasis)
    .normalize();
}

/**
 * Builds the explicit neutral gameplay orientation. Asset marker geometry is
 * corrected separately, so no imported weapon node or authored socket is used
 * as gameplay neutral.
 */
export function neutralSwordRotation(
  playerForward: Vector3,
  worldUp = Vector3.Up(),
): Quaternion {
  const forward = playerForward.clone().normalize();
  const up = worldUp.clone().normalize();
  const lateral = Vector3.Cross(up, forward).normalize();
  const down = Vector3.Cross(lateral, forward).normalize();
  return Quaternion.RotationQuaternionFromAxis(lateral, forward, down).normalize();
}

export function rootRelativePointToWorld(
  rootPosition: Vector3,
  rootRotation: Quaternion,
  rootRelativePoint: Vector3,
): Vector3 {
  return rootRelativePoint
    .clone()
    .rotateByQuaternionToRef(rootRotation, new Vector3())
    .addInPlace(rootPosition);
}

/** Repeatable phone-space controls used by the desktop pose lab. */
export function simulatedPhonePose(
  pose: SimulatedPoseName,
  angle = Math.PI / 5,
): Quaternion {
  // These controls use the new screen-up physical convention. Top-edge
  // elevation is rotation around the phone right edge; left/right is rotation
  // around the screen normal; roll is rotation around the top edge.
  const rightEdge = PHONE_RIGHT_EDGE_AXIS;
  const topEdge = PHONE_TOP_EDGE_AXIS;
  const screenNormal = PHONE_SCREEN_NORMAL_AXIS;

  switch (pose) {
    case "up":
      return Quaternion.RotationAxis(rightEdge, angle);
    case "down":
      return Quaternion.RotationAxis(rightEdge, -angle);
    case "left":
      return Quaternion.RotationAxis(screenNormal, angle);
    case "right":
      return Quaternion.RotationAxis(screenNormal, -angle);
    case "rollLeft":
      return Quaternion.RotationAxis(topEdge, -angle);
    case "rollRight":
      return Quaternion.RotationAxis(topEdge, angle);
    case "diagonalLeft":
      return Quaternion.RotationAxis(rightEdge, angle)
        .multiply(Quaternion.RotationAxis(screenNormal, angle * 0.8))
        .normalize();
    case "diagonalRight":
      return Quaternion.RotationAxis(rightEdge, -angle)
        .multiply(Quaternion.RotationAxis(screenNormal, -angle * 0.8))
        .normalize();
    case "neutral":
      return Quaternion.Identity();
  }
}

export function relativeOrientation(reference: Quaternion, current: Quaternion): Quaternion {
  return reference.clone().invert().multiply(current).normalize();
}

export function quaternionToTuple(quaternion: Quaternion): QuaternionTuple {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

export function tupleToQuaternion(tuple: QuaternionTuple): Quaternion {
  return new Quaternion(tuple[0], tuple[1], tuple[2], tuple[3]).normalize();
}

export function simulatedOrientation(timeSeconds: number): Quaternion {
  const yaw = Math.sin(timeSeconds * 1.2) * 0.45;
  const pitch = Math.sin(timeSeconds * 0.8 + 0.4) * 0.22;
  const roll = Math.sin(timeSeconds * 1.05 + 1.1) * 0.28;
  return Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, yaw)
    .multiply(Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, pitch))
    .multiply(Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, roll))
    .normalize();
}

export function getScreenOrientationAngle(): number {
  const screenAngle = window.screen.orientation?.angle;
  if (typeof screenAngle === "number" && Number.isFinite(screenAngle)) {
    return screenAngle;
  }
  const legacyAngle = window.orientation;
  return typeof legacyAngle === "number" && Number.isFinite(legacyAngle) ? legacyAngle : 0;
}
