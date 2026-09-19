import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";

import type { QuaternionTuple } from "./MotionTypes";

export type WeaponTargetSource = "none" | "controller";

/**
 * Runtime geometry is derived exclusively from the v05 marker nodes. The
 * vectors are expressed in the primary-grip marker frame, which means the
 * weapon can be translated and rotated without losing authored spacing.
 */
export interface WeaponGeometry {
  primaryToSecondaryGrip: Vector3;
  primaryToBladeBase: Vector3;
  primaryToBladeTip: Vector3;
  primaryToBladeUp: Vector3;
  bladeForward: Vector3;
  bladeUp: Vector3;
  bladeRight: Vector3;
  bladeLength: number;
  gripSpacing: number;
}

export interface WeaponMarkerWorlds {
  /** Optional reference frame; v05 passes WeaponRoot here. */
  weaponRootWorld?: Matrix;
  primaryGripWorld: Matrix;
  secondaryGripWorld: Matrix;
  bladeBaseWorld: Matrix;
  bladeTipWorld: Matrix;
  bladeUpWorld: Matrix;
}

export interface WeaponFrame {
  bladeForwardInPrimaryFrame: Vector3;
  bladeUpInPrimaryFrame: Vector3;
  bladeRightInPrimaryFrame: Vector3;
}

export interface WeaponTargetSnapshot {
  source: WeaponTargetSource;
  rootRelativeGripAnchor: [number, number, number];
  /** Primary grip anchor in world space. */
  worldPosition: [number, number, number];
  worldRotation: QuaternionTuple;
  swordOrigin: [number, number, number];
  swordBase: [number, number, number];
  swordTip: [number, number, number];
  primaryHandTarget: [number, number, number];
  secondaryHandTarget: [number, number, number];
  sessionGeneration: number | null;
  sequence: number | null;
}

export interface WeaponPosePoints {
  swordOrigin: Vector3;
  swordBase: Vector3;
  swordTip: Vector3;
  primaryHandTarget: Vector3;
  secondaryHandTarget: Vector3;
}

const AXIS_EPSILON = 1e-6;

function finiteVector(value: Vector3, fallback: Vector3): Vector3 {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
    ? value.clone()
    : fallback.clone();
}

function normalizedOr(value: Vector3, fallback: Vector3): Vector3 {
  const safe = finiteVector(value, fallback);
  const length = safe.length();
  return length > AXIS_EPSILON
    ? safe.scale(1 / length)
    : fallback.clone().normalize();
}

function orthogonalFallback(forward: Vector3): Vector3 {
  const reference = Math.abs(Vector3.Dot(forward, Vector3.Up())) < 0.95
    ? Vector3.Up()
    : Vector3.Right();
  return reference
    .subtract(forward.scale(Vector3.Dot(reference, forward)))
    .normalize();
}

function pointFromMatrix(matrix: Matrix): Vector3 {
  return Vector3.TransformCoordinates(Vector3.Zero(), matrix);
}

/** Returns a point expressed in the primary grip marker's frame. */
export function pointInPrimaryGripFrame(
  primaryGripWorld: Matrix,
  pointWorld: Vector3,
): Vector3 {
  return Vector3.TransformCoordinates(pointWorld, Matrix.Invert(primaryGripWorld));
}

/**
 * Derives marker geometry from the five v05 marker transforms. When the
 * WeaponRoot frame is supplied, every offset is expressed in that local
 * space; the primary marker frame is the deterministic unit-test fallback.
 * No authored axis or fallback coordinate is used for the normal path.
 */
export function deriveWeaponGeometry(markers: WeaponMarkerWorlds): WeaponGeometry {
  const referenceInverse = Matrix.Invert(
    markers.weaponRootWorld ?? markers.primaryGripWorld,
  );
  const primaryOrigin = Vector3.TransformCoordinates(
    pointFromMatrix(markers.primaryGripWorld),
    referenceInverse,
  );
  const toRootOffset = (matrix: Matrix): Vector3 =>
    Vector3.TransformCoordinates(pointFromMatrix(matrix), referenceInverse)
      .subtract(primaryOrigin);

  const primaryToSecondaryGrip = toRootOffset(markers.secondaryGripWorld);
  const primaryToBladeBase = toRootOffset(markers.bladeBaseWorld);
  const primaryToBladeTip = toRootOffset(markers.bladeTipWorld);
  const primaryToBladeUp = toRootOffset(markers.bladeUpWorld);

  const bladeVector = primaryToBladeTip.subtract(primaryToBladeBase);
  const bladeLength = bladeVector.length();
  const bladeForward = normalizedOr(bladeVector, Vector3.Up());

  let bladeUp = primaryToBladeUp.subtract(primaryToBladeBase);
  bladeUp = bladeUp.subtract(bladeForward.scale(Vector3.Dot(bladeUp, bladeForward)));
  bladeUp = normalizedOr(bladeUp, orthogonalFallback(bladeForward));

  // The right vector completes the marker-derived right-handed frame.
  const bladeRight = normalizedOr(Vector3.Cross(bladeForward, bladeUp), Vector3.Right());
  bladeUp = normalizedOr(Vector3.Cross(bladeRight, bladeForward), bladeUp);

  return {
    primaryToSecondaryGrip,
    primaryToBladeBase,
    primaryToBladeTip,
    primaryToBladeUp,
    bladeForward,
    bladeUp,
    bladeRight,
    bladeLength: Number.isFinite(bladeLength) ? bladeLength : 0,
    gripSpacing: primaryToSecondaryGrip.length(),
  };
}

/** Derives a visible weapon frame from marker-derived geometry. */
export function deriveWeaponFrame(geometry: WeaponGeometry): WeaponFrame {
  return {
    bladeForwardInPrimaryFrame: geometry.bladeForward.clone(),
    bladeUpInPrimaryFrame: geometry.bladeUp.clone(),
    bladeRightInPrimaryFrame: geometry.bladeRight.clone(),
  };
}

/** Converts the authored marker frame into the canonical gameplay frame. */
export function weaponFrameCorrection(frame: WeaponFrame): Quaternion {
  const authoredFrame = Quaternion.RotationQuaternionFromAxis(
    frame.bladeRightInPrimaryFrame,
    frame.bladeForwardInPrimaryFrame,
    frame.bladeUpInPrimaryFrame,
  ).normalize();
  return authoredFrame.clone().invert().normalize();
}

/** Applies the asset-to-gameplay correction to marker geometry offsets. */
export function transformWeaponGeometryToGameplay(
  geometry: WeaponGeometry,
  assetToGameplay: Quaternion,
): WeaponGeometry {
  const transform = (value: Vector3): Vector3 =>
    value.rotateByQuaternionToRef(assetToGameplay, new Vector3());
  const primaryToBladeBase = transform(geometry.primaryToBladeBase);
  const primaryToBladeTip = transform(geometry.primaryToBladeTip);
  const primaryToBladeUp = transform(geometry.primaryToBladeUp);
  const bladeForward = normalizedOr(
    primaryToBladeTip.subtract(primaryToBladeBase),
    Vector3.Up(),
  );
  const bladeUp = normalizedOr(transform(geometry.bladeUp), Vector3.Up());
  const bladeRight = normalizedOr(transform(geometry.bladeRight), Vector3.Right());
  return {
    primaryToSecondaryGrip: transform(geometry.primaryToSecondaryGrip),
    primaryToBladeBase,
    primaryToBladeTip,
    primaryToBladeUp,
    bladeForward,
    bladeUp,
    bladeRight,
    bladeLength: geometry.bladeLength,
    gripSpacing: geometry.gripSpacing,
  };
}

function pointFromPrimaryGrip(
  gripAnchor: Vector3,
  rotation: Quaternion,
  primaryFramePoint: Vector3,
): Vector3 {
  return primaryFramePoint
    .rotateByQuaternionToRef(rotation, new Vector3())
    .addInPlace(gripAnchor);
}

export function deriveWeaponPosePoints(
  gripAnchor: Vector3,
  rotation: Quaternion,
  geometry: WeaponGeometry,
): WeaponPosePoints {
  const normalizedRotation = rotation.clone().normalize();
  return {
    swordOrigin: gripAnchor.clone(),
    swordBase: pointFromPrimaryGrip(
      gripAnchor,
      normalizedRotation,
      geometry.primaryToBladeBase,
    ),
    swordTip: pointFromPrimaryGrip(
      gripAnchor,
      normalizedRotation,
      geometry.primaryToBladeTip,
    ),
    primaryHandTarget: gripAnchor.clone(),
    secondaryHandTarget: pointFromPrimaryGrip(
      gripAnchor,
      normalizedRotation,
      geometry.primaryToSecondaryGrip,
    ),
  };
}

/**
 * Converts an authored hand-local contact point into the wrist target needed
 * to place that contact on a marker in world space.
 */
export function deriveWristTargetFromGrip(
  gripWorld: Vector3,
  desiredHandRotation: Quaternion,
  handContactLocal: Vector3,
): Vector3 {
  return gripWorld.subtract(
    handContactLocal.rotateByQuaternionToRef(
      desiredHandRotation,
      new Vector3(),
    ),
  );
}

/**
 * Reconstructs the actual palm/contact point from the solved hand bone. This
 * is intentionally separate from wrist target construction so diagnostics
 * measure the hand's real post-IK contact rather than reusing the target math.
 */
export function deriveActualHandContact(
  handWorldPosition: Vector3,
  handWorldRotation: Quaternion,
  handContactLocal: Vector3,
): Vector3 {
  return handContactLocal
    .rotateByQuaternionToRef(handWorldRotation, new Vector3())
    .addInPlace(handWorldPosition);
}

function tuple3(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

function tuple4(quaternion: Quaternion): QuaternionTuple {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

/**
 * Canonical controller-owned weapon pose. This is data, not a scene node, so
 * animation groups and hand bones cannot become the gameplay authority.
 */
export class WeaponTarget {
  readonly rootRelativeGripAnchor = new Vector3();
  readonly worldPosition = new Vector3();
  readonly worldRotation = new Quaternion();
  readonly swordOrigin = new Vector3();
  readonly swordBase = new Vector3();
  readonly swordTip = new Vector3();
  readonly primaryHandTarget = new Vector3();
  readonly secondaryHandTarget = new Vector3();

  source: WeaponTargetSource = "none";
  sessionGeneration: number | null = null;
  sequence: number | null = null;
  private geometry: WeaponGeometry | null = null;

  setGeometry(geometry: WeaponGeometry): void {
    this.geometry = cloneGeometry(geometry);
  }

  setRest(
    rootRelativeGripAnchor: Vector3,
    worldPosition: Vector3,
    worldRotation: Quaternion,
  ): void {
    this.apply(rootRelativeGripAnchor, worldPosition, worldRotation, "none", null, null);
  }

  setController(
    rootRelativeGripAnchor: Vector3,
    worldPosition: Vector3,
    worldRotation: Quaternion,
    sessionGeneration: number,
    sequence: number,
  ): void {
    this.apply(
      rootRelativeGripAnchor,
      worldPosition,
      worldRotation,
      "controller",
      sessionGeneration,
      sequence,
    );
  }

  snapshot(): WeaponTargetSnapshot {
    return {
      source: this.source,
      rootRelativeGripAnchor: tuple3(this.rootRelativeGripAnchor),
      worldPosition: tuple3(this.worldPosition),
      worldRotation: tuple4(this.worldRotation),
      swordOrigin: tuple3(this.swordOrigin),
      swordBase: tuple3(this.swordBase),
      swordTip: tuple3(this.swordTip),
      primaryHandTarget: tuple3(this.primaryHandTarget),
      secondaryHandTarget: tuple3(this.secondaryHandTarget),
      sessionGeneration: this.sessionGeneration,
      sequence: this.sequence,
    };
  }

  private apply(
    rootRelativeGripAnchor: Vector3,
    worldPosition: Vector3,
    worldRotation: Quaternion,
    source: WeaponTargetSource,
    sessionGeneration: number | null,
    sequence: number | null,
  ): void {
    this.rootRelativeGripAnchor.copyFrom(rootRelativeGripAnchor);
    this.worldPosition.copyFrom(worldPosition);
    this.worldRotation.copyFrom(worldRotation).normalize();
    const geometry = this.geometry;
    if (geometry) {
      const points = deriveWeaponPosePoints(this.worldPosition, this.worldRotation, geometry);
      this.swordOrigin.copyFrom(points.swordOrigin);
      this.swordBase.copyFrom(points.swordBase);
      this.swordTip.copyFrom(points.swordTip);
      this.primaryHandTarget.copyFrom(points.primaryHandTarget);
      this.secondaryHandTarget.copyFrom(points.secondaryHandTarget);
    } else {
      this.swordOrigin.copyFrom(this.worldPosition);
      this.swordBase.copyFrom(this.worldPosition);
      this.swordTip.copyFrom(this.worldPosition);
      this.primaryHandTarget.copyFrom(this.worldPosition);
      this.secondaryHandTarget.copyFrom(this.worldPosition);
    }
    this.source = source;
    this.sessionGeneration = sessionGeneration;
    this.sequence = sequence;
  }
}

function cloneGeometry(geometry: WeaponGeometry): WeaponGeometry {
  return {
    primaryToSecondaryGrip: geometry.primaryToSecondaryGrip.clone(),
    primaryToBladeBase: geometry.primaryToBladeBase.clone(),
    primaryToBladeTip: geometry.primaryToBladeTip.clone(),
    primaryToBladeUp: geometry.primaryToBladeUp.clone(),
    bladeForward: geometry.bladeForward.clone(),
    bladeUp: geometry.bladeUp.clone(),
    bladeRight: geometry.bladeRight.clone(),
    bladeLength: geometry.bladeLength,
    gripSpacing: geometry.gripSpacing,
  };
}

/**
 * Rotates a radial shell direction by the swing between two forward vectors.
 * Twist/roll is intentionally absent, so phone roll changes orientation while
 * leaving the primary grip on the same shell location.
 */
export function solveSphericalShellPosition(
  center: Vector3,
  neutralAnchor: Vector3,
  neutralForward: Vector3,
  desiredForward: Vector3,
  radius: number,
): Vector3 {
  const safeCenter = finiteVector(center, Vector3.Zero());
  const safeNeutralAnchor = finiteVector(neutralAnchor, safeCenter.add(Vector3.Forward()));
  const from = normalizedOr(neutralForward, Vector3.Forward());
  const to = normalizedOr(desiredForward, from);
  let radial = safeNeutralAnchor.subtract(safeCenter);
  if (radial.length() <= AXIS_EPSILON) radial = from.clone();

  const dot = Math.max(-1, Math.min(1, Vector3.Dot(from, to)));
  const cross = Vector3.Cross(from, to);
  let swing = Quaternion.Identity();
  if (cross.length() > AXIS_EPSILON) {
    swing = new Quaternion(cross.x, cross.y, cross.z, 1 + dot).normalize();
  } else if (dot < 0) {
    const axis = orthogonalFallback(from);
    swing = Quaternion.RotationAxis(axis, Math.PI);
  }

  radial = radial.rotateByQuaternionToRef(swing, new Vector3()).normalize();
  const safeRadius = Number.isFinite(radius) && radius > AXIS_EPSILON
    ? radius
    : safeNeutralAnchor.subtract(safeCenter).length();
  return safeCenter.add(radial.scale(Math.max(safeRadius, AXIS_EPSILON)));
}
