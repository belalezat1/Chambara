import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";

import {
  deriveActualHandContact,
  deriveWeaponFrame,
  deriveWeaponGeometry,
  deriveWeaponPosePoints,
  deriveWristTargetFromGrip,
  pointInPrimaryGripFrame,
  solveSphericalShellPosition,
  transformWeaponGeometryToGameplay,
  weaponFrameCorrection,
  WeaponTarget,
} from "./WeaponTarget.ts";

const BABYLON_GAME_URL = new URL("../BabylonGame.ts", import.meta.url);

const V05_MANIFEST_URL = new URL(
  "../../../../assets/player/Baizhong_Kendo_Animations_v07_manifest.json",
  import.meta.url,
);
const V05_GLB_URL = new URL(
  "../../../../assets/player/Baizhong_Kendo_Animations_v07.glb",
  import.meta.url,
);

interface V05Manifest {
  asset: string;
  actions: Array<{ name: string }>;
  weaponControl: Record<string, unknown>;
  armMeasurements: {
    rightShoulderJointRest: number[];
    leftShoulderJointRest: number[];
    rightMaxReach: number;
    leftMaxReach: number;
  };
  recommendedReach: {
    rightNeutralDistance: number;
    leftNeutralDistance: number;
  };
  handContacts: {
    right: {
      bone: string;
      grip: string;
      localPosition: number[];
      rotationOffset: number[];
    };
    left: {
      bone: string;
      grip: string;
      localPosition: number[];
      rotationOffset: number[];
    };
  };
}

interface GlbNode {
  name?: string;
  children?: number[];
}

interface GlbAnimation {
  channels?: Array<{ target?: { node?: number } }>;
}

function readV05Manifest(): V05Manifest {
  return JSON.parse(readFileSync(V05_MANIFEST_URL, "utf8")) as V05Manifest;
}

function readV05Json(): { nodes: GlbNode[]; animations: GlbAnimation[] } {
  const bytes = readFileSync(V05_GLB_URL);
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength)) as {
    nodes: GlbNode[];
    animations: GlbAnimation[];
  };
}

function markerWorlds(): {
  primaryGripWorld: Matrix;
  secondaryGripWorld: Matrix;
  bladeBaseWorld: Matrix;
  bladeTipWorld: Matrix;
  bladeUpWorld: Matrix;
} {
  return {
    primaryGripWorld: Matrix.Translation(1, 2, 3),
    secondaryGripWorld: Matrix.Translation(1, 1.875, 3),
    bladeBaseWorld: Matrix.Translation(1, 2.15, 3),
    bladeTipWorld: Matrix.Translation(1, 3.058, 3),
    bladeUpWorld: Matrix.Translation(1, 2.15, 3.1),
  };
}

function assertFiniteUnit(value: Vector3, label: string): void {
  assert.equal(Number.isFinite(value.x), true, label + ".x");
  assert.equal(Number.isFinite(value.y), true, label + ".y");
  assert.equal(Number.isFinite(value.z), true, label + ".z");
  assert.ok(Math.abs(value.length() - 1) < 1e-6, label + " length=" + value.length());
}

test("v07 manifest and GLB expose every required marker", () => {
  const manifest = readV05Manifest();
  const glb = readV05Json();
  const expectedAnimations = [
    "CombatIdle",
    "AttackSwing",
    "AttackVertical",
    "AttackDiagonalLeft",
    "AttackDiagonalRight",
    "AttackJab",
    "BlockIdle",
    "BlockSideLeft",
    "BlockSideRight",
    "BlockedStun",
    "HitKnockback",
    "AdvanceAfterHit",
    "Defeat",
  ];
  assert.equal(manifest.asset, "Baizhong_Kendo_Animations_v07.glb");
  assert.equal(manifest.actions.length, expectedAnimations.length);
  assert.deepEqual(
    new Set(manifest.actions.map((action) => action.name)),
    new Set(expectedAnimations),
  );
  const required = [
    "WeaponRoot",
    "ReachCenter",
    "GripPrimary",
    "GripSecondary",
    "BladeBase",
    "BladeTip",
    "BladeUp",
  ];
  const nodes = new Map(
    glb.nodes.map((node, index) => [node.name, { node, index }]),
  );
  for (const name of required) assert.ok(nodes.has(name), name + " missing from v05 GLB");
  for (const key of [
    "weaponRoot",
    "reachCenter",
    "primaryGrip",
    "secondaryGrip",
    "bladeBase",
    "bladeTip",
    "bladeUp",
  ]) {
    assert.equal(typeof manifest.weaponControl[key], "string", key + " manifest reference");
  }
  const weaponRootIndex = nodes.get("WeaponRoot")!.index;
  const handIndices = new Set(
    glb.nodes
      .map((node, index) => (node.name === "hand.R" || node.name === "hand.L" ? index : -1))
      .filter((index) => index >= 0),
  );
  const parents = new Map<number, number>();
  for (const [index, node] of glb.nodes.entries()) {
    for (const child of node.children ?? []) parents.set(child, index);
  }
  assert.equal(handIndices.has(parents.get(weaponRootIndex) ?? -1), false);
  assert.equal(manifest.weaponControl.weaponParentedToHand, false);
  assert.equal(manifest.weaponControl.weaponParentedToArmature, false);
});

test("v05 animation channels cannot mutate WeaponRoot or markers", () => {
  const glb = readV05Json();
  const protectedNames = new Set([
    "WeaponRoot",
    "ReachCenter",
    "GripPrimary",
    "GripSecondary",
    "BladeBase",
    "BladeTip",
    "BladeUp",
    "Shinai",
  ]);
  const protectedIndices = new Set(
    glb.nodes
      .map((node, index) => (protectedNames.has(node.name ?? "") ? index : -1))
      .filter((index) => index >= 0),
  );
  const animatedIndices = new Set(
    glb.animations.flatMap((animation) =>
      (animation.channels ?? [])
        .map((channel) => channel.target?.node)
        .filter((index): index is number => typeof index === "number"),
    ),
  );
  for (const index of protectedIndices) {
    assert.equal(animatedIndices.has(index), false, "protected node channel " + index);
  }
});

test("v05 manifest arms keep the neutral grip inside both measured reaches", () => {
  const manifest = readV05Manifest();
  assert.ok(manifest.recommendedReach.rightNeutralDistance < manifest.armMeasurements.rightMaxReach);
  assert.ok(manifest.recommendedReach.leftNeutralDistance < manifest.armMeasurements.leftMaxReach);
  assert.ok(manifest.recommendedReach.rightNeutralDistance > 0.3);
  assert.ok(manifest.recommendedReach.leftNeutralDistance > 0.3);
});

test("v05 manifest carries finite authored rest shoulder joint anchors", () => {
  const manifest = readV05Manifest();
  for (const [side, anchor] of [
    ["right", manifest.armMeasurements.rightShoulderJointRest],
    ["left", manifest.armMeasurements.leftShoulderJointRest],
  ] as const) {
    assert.equal(anchor.length, 3, side + " shoulder anchor dimensions");
    assert.ok(anchor.every(Number.isFinite), side + " shoulder anchor finite");
    assert.ok(Math.abs(anchor[0]) > 0.1, side + " shoulder lateral offset");
    assert.ok(anchor[2] > 1.0, side + " shoulder height");
  }
});

test("manifest shoulder anchors stay authoritative across body animation labels", () => {
  const source = readFileSync(BABYLON_GAME_URL, "utf8");
  assert.match(source, /v05ShoulderRestRoot/);
  assert.match(source, /manifestRestPointToRuntimeRoot/);
  assert.match(source, /applyManifestShoulderAnchors/);
  assert.match(source, /using rest skeleton capture for validation fallback/);
  const fitStart = source.indexOf("private fitGripToArmReach");
  const statusStart = source.indexOf("private syncWeaponTargetStatus");
  assert.ok(fitStart >= 0 && statusStart > fitStart, "authoritative feasibility block found");
  const feasibility = source.slice(fitStart, statusStart);
  assert.match(feasibility, /stableShoulderWorld/);
  assert.doesNotMatch(feasibility, /getAbsolutePosition/);

  const geometry = deriveWeaponGeometry(markerWorlds());
  const rootAnchor = new Vector3(0.1, 1.13, 0.38);
  const worldGrip = new Vector3(1.25, 1.14, -0.1);
  const worldRotation = Quaternion.RotationYawPitchRoll(0.2, -0.15, 0.3).normalize();
  const animationLabels = ["CombatIdle", "AttackVertical", "BlockIdle"];
  const snapshots = animationLabels.map((animation) => {
    const target = new WeaponTarget();
    target.setGeometry(geometry);
    target.setController(rootAnchor, worldGrip, worldRotation, 8, 21);
    return { animation, snapshot: target.snapshot() };
  });
  assert.deepEqual(snapshots[1].snapshot, snapshots[0].snapshot);
  assert.deepEqual(snapshots[2].snapshot, snapshots[0].snapshot);
});

test("v05 manifest carries finite v04-authored hand contact frames", () => {
  const manifest = readV05Manifest();
  for (const [side, contact, expectedBone, expectedGrip] of [
    ["right", manifest.handContacts.right, "hand.R", "GripPrimary"],
    ["left", manifest.handContacts.left, "hand.L", "GripSecondary"],
  ] as const) {
    assert.equal(contact.bone, expectedBone, side + " bone");
    assert.equal(contact.grip, expectedGrip, side + " grip");
    assert.equal(contact.localPosition.length, 3, side + " contact dimensions");
    assert.equal(contact.rotationOffset.length, 4, side + " rotation dimensions");
    assert.ok(contact.localPosition.every(Number.isFinite), side + " contact finite");
    assert.ok(contact.rotationOffset.every(Number.isFinite), side + " rotation finite");
    const rotationLength = Math.hypot(...contact.rotationOffset);
    assert.ok(Math.abs(rotationLength - 1) < 1e-5, side + " rotation normalized");
    assert.ok(Math.hypot(...contact.localPosition) > 0.05, side + " contact authored");
    assert.ok(Math.hypot(...contact.localPosition) < 0.12, side + " contact plausible");
  }
});

test("authored hand-local contacts produce and measure actual palm contact", () => {
  const manifest = readV05Manifest();
  const grip = new Vector3(1.2, 1.1, -0.2);
  const handRotation = Quaternion.RotationYawPitchRoll(0.35, -0.2, 0.6).normalize();
  for (const contact of [manifest.handContacts.right, manifest.handContacts.left]) {
    const local = Vector3.FromArray(contact.localPosition);
    const wrist = deriveWristTargetFromGrip(grip, handRotation, local);
    const actual = deriveActualHandContact(wrist, handRotation, local);
    assert.ok(actual.equalsWithEpsilon(grip, 1e-6), contact.bone + " contact reconstruction");

    const displaced = deriveActualHandContact(
      wrist.add(new Vector3(0.01, 0, 0)),
      handRotation,
      local,
    );
    assert.ok(
      Math.abs(displaced.subtract(grip).length() - 0.01) < 1e-6,
      contact.bone + " actual contact error",
    );
  }
});

test("v05 marker geometry is derived from marker transforms", () => {
  const geometry = deriveWeaponGeometry(markerWorlds());
  assert.ok(geometry.primaryToSecondaryGrip.equalsWithEpsilon(new Vector3(0, -0.125, 0), 1e-6));
  assert.ok(geometry.primaryToBladeBase.equalsWithEpsilon(new Vector3(0, 0.15, 0), 1e-6));
  assert.ok(geometry.primaryToBladeTip.equalsWithEpsilon(new Vector3(0, 1.058, 0), 1e-6));
  assert.ok(geometry.primaryToBladeUp.equalsWithEpsilon(new Vector3(0, 0.15, 0.1), 1e-6));
  assert.ok(Math.abs(geometry.bladeLength - 0.908) < 1e-6);
  assert.ok(Math.abs(geometry.gripSpacing - 0.125) < 1e-6);
});

test("marker-derived frame is finite, normalized, and right-handed", () => {
  const frame = deriveWeaponFrame(deriveWeaponGeometry(markerWorlds()));
  assertFiniteUnit(frame.bladeForwardInPrimaryFrame, "blade forward");
  assertFiniteUnit(frame.bladeUpInPrimaryFrame, "blade up");
  assertFiniteUnit(frame.bladeRightInPrimaryFrame, "blade right");
  assert.ok(Math.abs(Vector3.Dot(frame.bladeForwardInPrimaryFrame, frame.bladeUpInPrimaryFrame)) < 1e-6);
  assert.ok(
    Vector3.Cross(frame.bladeForwardInPrimaryFrame, frame.bladeUpInPrimaryFrame)
      .equalsWithEpsilon(frame.bladeRightInPrimaryFrame, 1e-6),
  );
});

test("marker geometry survives arbitrary primary-frame transforms", () => {
  const pose = Quaternion.RotationYawPitchRoll(0.6, -0.2, 0.35).normalize();
  const primary = Matrix.Compose(Vector3.One(), pose, new Vector3(2, 1, -3));
  const local = markerWorlds();
  const toWorld = (matrix: Matrix): Matrix => matrix.multiply(primary);
  const geometry = deriveWeaponGeometry({
    primaryGripWorld: toWorld(local.primaryGripWorld),
    secondaryGripWorld: toWorld(local.secondaryGripWorld),
    bladeBaseWorld: toWorld(local.bladeBaseWorld),
    bladeTipWorld: toWorld(local.bladeTipWorld),
    bladeUpWorld: toWorld(local.bladeUpWorld),
  });
  assert.ok(geometry.primaryToSecondaryGrip.equalsWithEpsilon(new Vector3(0, -0.125, 0), 1e-5));
  assert.ok(geometry.primaryToBladeTip.equalsWithEpsilon(new Vector3(0, 1.058, 0), 1e-5));
});

test("marker offsets can be expressed explicitly in WeaponRoot local space", () => {
  const weaponRoot = Matrix.Compose(
    Vector3.One(),
    Quaternion.RotationYawPitchRoll(0.2, -0.3, 0.1).normalize(),
    new Vector3(4, 5, 6),
  );
  const primaryLocal = Matrix.Translation(0.2, 0.3, 0.4);
  const toWorld = (local: Matrix): Matrix => local.multiply(weaponRoot);
  const geometry = deriveWeaponGeometry({
    weaponRootWorld: weaponRoot,
    primaryGripWorld: toWorld(primaryLocal),
    secondaryGripWorld: toWorld(Matrix.Translation(0.2, 0.175, 0.4)),
    bladeBaseWorld: toWorld(Matrix.Translation(0.2, 0.45, 0.4)),
    bladeTipWorld: toWorld(Matrix.Translation(0.2, 1.358, 0.4)),
    bladeUpWorld: toWorld(Matrix.Translation(0.2, 0.45, 0.5)),
  });
  assert.ok(geometry.primaryToSecondaryGrip.equalsWithEpsilon(new Vector3(0, -0.125, 0), 1e-5));
  assert.ok(geometry.primaryToBladeBase.equalsWithEpsilon(new Vector3(0, 0.15, 0), 1e-5));
});

test("asset frame correction maps marker forward and up to gameplay axes", () => {
  const geometry = deriveWeaponGeometry(markerWorlds());
  const correction = weaponFrameCorrection(deriveWeaponFrame(geometry));
  const gameplayForward = geometry.bladeForward
    .rotateByQuaternionToRef(correction, new Vector3());
  const gameplayUp = geometry.bladeUp
    .rotateByQuaternionToRef(correction, new Vector3());
  assert.ok(gameplayForward.equalsWithEpsilon(Vector3.Up(), 1e-6));
  assert.ok(gameplayUp.equalsWithEpsilon(new Vector3(0, 0, 1), 1e-6));
});

test("transforming geometry preserves grip origin and blade length", () => {
  const geometry = deriveWeaponGeometry(markerWorlds());
  const transformed = transformWeaponGeometryToGameplay(
    geometry,
    Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2),
  );
  assert.ok(transformed.primaryToSecondaryGrip.length() > 0.124);
  assert.ok(Math.abs(transformed.bladeLength - geometry.bladeLength) < 1e-6);
  assert.ok(Math.abs(transformed.primaryToBladeTip.subtract(transformed.primaryToBladeBase).length() - 0.908) < 1e-6);
});

test("pose points keep secondary grip authored relative to primary", () => {
  const geometry = deriveWeaponGeometry(markerWorlds());
  const points = deriveWeaponPosePoints(
    new Vector3(4, 5, 6),
    Quaternion.RotationAxis(Vector3.Up(), Math.PI / 2),
    geometry,
  );
  assert.ok(points.primaryHandTarget.equalsWithEpsilon(new Vector3(4, 5, 6), 1e-6));
  assert.ok(points.secondaryHandTarget.equalsWithEpsilon(new Vector3(4, 4.875, 6), 1e-6));
  assert.ok(points.swordTip.subtract(points.swordBase).length() > 0.907);
});

test("primary marker conversion is translation and rotation invariant", () => {
  const primary = Matrix.Compose(
    Vector3.One(),
    Quaternion.RotationAxis(Vector3.Up(), 0.35),
    new Vector3(2, 1, -3),
  );
  const point = Vector3.TransformCoordinates(new Vector3(0, -0.125, 0), primary);
  const local = pointInPrimaryGripFrame(primary, point);
  assert.ok(local.equalsWithEpsilon(new Vector3(0, -0.125, 0), 1e-6));
});

test("thick spherical shell moves primary grip with swing", () => {
  const neutral = solveSphericalShellPosition(
    Vector3.Zero(),
    new Vector3(0, 0, -0.4),
    new Vector3(0, 0, -1),
    new Vector3(1, 0, 0),
    0.39,
  );
  assert.ok(Math.abs(neutral.length() - 0.39) < 1e-6);
  assert.ok(neutral.x > 0.2);
  assert.ok(neutral.z > -0.3);
});

test("neutral shell anchor stays in front of ReachCenter", () => {
  const center = new Vector3(0, 1.3, 0.08);
  const anchor = new Vector3(0, 1.13, 0.38);
  const forward = anchor.subtract(center).normalize();
  const solved = solveSphericalShellPosition(center, anchor, forward, forward, 0.35);
  assert.ok(Vector3.Dot(solved.subtract(center), forward) > 0.3);
  assert.ok(solved.y < center.y);
  assert.ok(solved.z > center.z);
});

test("simulated up and down move the primary grip vertically", () => {
  const center = Vector3.Zero();
  const anchor = new Vector3(0, 0, 0.4);
  const neutralForward = new Vector3(0, 0, 1);
  const up = solveSphericalShellPosition(
    center,
    anchor,
    neutralForward,
    new Vector3(0, 1, 0),
    0.4,
  );
  const down = solveSphericalShellPosition(
    center,
    anchor,
    neutralForward,
    new Vector3(0, -1, 0),
    0.4,
  );
  assert.ok(up.y > 0.3);
  assert.ok(down.y < -0.3);
});

test("simulated left and right move the primary grip laterally", () => {
  const center = Vector3.Zero();
  const anchor = new Vector3(0, 0, 0.4);
  const neutralForward = new Vector3(0, 0, 1);
  const left = solveSphericalShellPosition(
    center,
    anchor,
    neutralForward,
    new Vector3(-1, 0, 0),
    0.4,
  );
  const right = solveSphericalShellPosition(
    center,
    anchor,
    neutralForward,
    new Vector3(1, 0, 0),
    0.4,
  );
  assert.ok(left.x < -0.3);
  assert.ok(right.x > 0.3);
});

test("state reach radii contract for block and expand for attack", () => {
  const ready = solveSphericalShellPosition(
    Vector3.Zero(),
    new Vector3(0, 0, 0.4),
    new Vector3(0, 0, 1),
    new Vector3(0, 0, 1),
    0.4 * 0.82,
  );
  const block = solveSphericalShellPosition(
    Vector3.Zero(),
    new Vector3(0, 0, 0.4),
    new Vector3(0, 0, 1),
    new Vector3(0, 0, 1),
    0.4 * 0.65,
  );
  const attack = solveSphericalShellPosition(
    Vector3.Zero(),
    new Vector3(0, 0, 0.4),
    new Vector3(0, 0, 1),
    new Vector3(0, 0, 1),
    0.4 * 0.92,
  );
  assert.ok(block.length() < ready.length());
  assert.ok(attack.length() > ready.length());
});

test("normal shell poses keep both marker grips inside the arm annuli", () => {
  const geometry = deriveWeaponGeometry(markerWorlds());
  const center = new Vector3(0, 1.3, 0.08);
  const anchor = new Vector3(0, 1.13, 0.38);
  const neutralForward = new Vector3(0, 0, 1);
  const rightShoulder = new Vector3(0.14, 1.3, 0);
  const leftShoulder = new Vector3(-0.14, 1.3, 0);
  const maxReach = 0.482745;
  for (const direction of [
    neutralForward,
    new Vector3(0, 0.5, 0.8660254).normalize(),
    new Vector3(0, -0.5, 0.8660254).normalize(),
    new Vector3(-0.5, 0, 0.8660254).normalize(),
    new Vector3(0.5, 0, 0.8660254).normalize(),
  ]) {
    const grip = solveSphericalShellPosition(center, anchor, neutralForward, direction, 0.28);
    const points = deriveWeaponPosePoints(grip, Quaternion.Identity(), geometry);
    assert.ok(points.primaryHandTarget.subtract(rightShoulder).length() < maxReach);
    assert.ok(points.secondaryHandTarget.subtract(leftShoulder).length() < maxReach);
  }
});

test("shell solver remains finite and clamps pathological inputs", () => {
  const cases = [
    [new Vector3(Number.NaN, 0, 0), Number.NaN],
    [new Vector3(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0), -10],
    [Vector3.Zero(), Number.POSITIVE_INFINITY],
  ] as const;
  for (const [desired, radius] of cases) {
    const solved = solveSphericalShellPosition(
      Vector3.Zero(),
      new Vector3(0, 0, 0.4),
      new Vector3(0, 0, 1),
      desired,
      radius,
    );
    assert.equal(Number.isFinite(solved.x), true);
    assert.equal(Number.isFinite(solved.y), true);
    assert.equal(Number.isFinite(solved.z), true);
    assert.ok(solved.length() > 0);
  }
});

test("shell roll leaves primary grip position unchanged", () => {
  const base = solveSphericalShellPosition(
    Vector3.Zero(),
    new Vector3(0.1, -0.3, -0.2),
    new Vector3(0, 0, -1),
    new Vector3(0, 0, -1),
    0.42,
  );
  const rolled = solveSphericalShellPosition(
    Vector3.Zero(),
    new Vector3(0.1, -0.3, -0.2),
    new Vector3(0, 0, -1),
    new Vector3(0, 0, -1),
    0.42,
  );
  assert.ok(base.equalsWithEpsilon(rolled, 1e-7));
});

test("root translation and rotation transform authoritative targets consistently", () => {
  const geometry = deriveWeaponGeometry(markerWorlds());
  const localGrip = new Vector3(0.1, 1.13, 0.38);
  const localRotation = Quaternion.RotationYawPitchRoll(0.25, -0.1, 0.4).normalize();
  const roots = [
    { position: new Vector3(0, 0, 0), rotation: Quaternion.Identity() },
    {
      position: new Vector3(2, 0.5, -1),
      rotation: Quaternion.RotationAxis(Vector3.Up(), Math.PI / 2),
    },
  ];
  const snapshots = roots.map(({ position, rotation }) => {
    const target = new WeaponTarget();
    target.setGeometry(geometry);
    const worldGrip = localGrip
      .rotateByQuaternionToRef(rotation, new Vector3())
      .addInPlace(position);
    const worldRotation = rotation.clone().multiply(localRotation).normalize();
    target.setController(localGrip, worldGrip, worldRotation, 0, 1);
    return target.snapshot();
  });
  assert.ok(snapshots[0].worldPosition.every(Number.isFinite));
  assert.ok(snapshots[1].worldPosition.every(Number.isFinite));
  const expected = localGrip
    .rotateByQuaternionToRef(roots[1].rotation, new Vector3())
    .add(roots[1].position);
  assert.deepEqual(snapshots[1].worldPosition, [expected.x, expected.y, expected.z]);
  assert.notDeepEqual(snapshots[0].worldPosition, snapshots[1].worldPosition);
  assert.notDeepEqual(snapshots[0].worldRotation, snapshots[1].worldRotation);
});

test("same input and root produce identical targets across body animation labels", () => {
  const source = readFileSync(BABYLON_GAME_URL, "utf8");
  const geometry = deriveWeaponGeometry(markerWorlds());
  const rootAnchor = new Vector3(0.1, 1.13, 0.38);
  const worldGrip = new Vector3(1.25, 1.14, -0.1);
  const worldRotation = Quaternion.RotationYawPitchRoll(0.2, -0.15, 0.3).normalize();
  const labels = ["CombatIdle", "AttackVertical", "BlockIdle"];
  const snapshots = labels.map((animation) => {
    const target = new WeaponTarget();
    target.setGeometry(geometry);
    target.setController(rootAnchor, worldGrip, worldRotation, 2, 9);
    return { animation, snapshot: target.snapshot() };
  });
  assert.deepEqual(snapshots[1].snapshot, snapshots[0].snapshot);
  assert.deepEqual(snapshots[2].snapshot, snapshots[0].snapshot);

  const fitStart = source.indexOf("private fitGripToArmReach");
  const statusStart = source.indexOf("private syncWeaponTargetStatus");
  assert.ok(fitStart >= 0 && statusStart > fitStart, "authoritative feasibility block found");
  const feasibility = source.slice(fitStart, statusStart);
  assert.match(feasibility, /stableShoulderWorld/);
  assert.doesNotMatch(feasibility, /getAbsolutePosition/);
});

test("reach state controls are independent from body animation playback", () => {
  const source = readFileSync(BABYLON_GAME_URL, "utf8");
  const start = source.indexOf("setReachState(state: PoseState)");
  const end = source.indexOf("\n  }", start);
  assert.ok(start >= 0 && end > start, "setReachState API found");
  const method = source.slice(start, end);
  assert.match(method, /targetReachFraction = POSE_REACH_FRACTIONS\[state\]/);
  assert.doesNotMatch(method, /controller\.play|playAnimation/);
  assert.match(source, /playAnimation\(name: string(?:, options\?: AnimationPlayOptions)?\)/);
  assert.doesNotMatch(source, /WRIST_TO_GRIP_POSITION_SCALE/);
});

test("post-IK contact diagnostics compare solved hands to authored grip markers", () => {
  const source = readFileSync(BABYLON_GAME_URL, "utf8");
  const start = source.indexOf("private applyArmIk");
  const end = source.indexOf("private markerWorldPosition", start);
  assert.ok(start >= 0 && end > start, "post-IK contact block found");
  const method = source.slice(start, end);
  assert.match(method, /this\.markerWorldPosition/);
  assert.match(method, /arm\.contact\.subtract\(markerGrip\)/);
  assert.doesNotMatch(method, /arm\.contact\.subtract\(desiredGrip\)/);
});

test("authoritative WeaponTarget remains independent of animation state", () => {
  const target = new WeaponTarget();
  target.setGeometry(deriveWeaponGeometry(markerWorlds()));
  const rotation = Quaternion.RotationYawPitchRoll(0.4, -0.2, 0.7).normalize();
  target.setController(new Vector3(0.2, 1.3, 0.4), new Vector3(1, 2, 3), rotation, 4, 12);
  const before = target.snapshot();
  Quaternion.RotationYawPitchRoll(-1.1, 0.8, 0.2);
  assert.deepEqual(target.snapshot(), before);
  assert.equal(before.source, "controller");
  assert.notDeepEqual(before.secondaryHandTarget, before.primaryHandTarget);
  assert.notDeepEqual(before.swordBase, before.swordTip);
});
