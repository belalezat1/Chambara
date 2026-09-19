import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Quaternion, Vector3 } from "@babylonjs/core";

import {
  deviceOrientationToQuaternion,
  derivePhoneToGameplayBasis,
  GAMEPLAY_BLADE_UP_AXIS,
  neutralSwordRotation,
  orthonormalFrame,
  phoneDeltaToGameDelta,
  PHONE_CONTROLLER_FRAME,
  PHYSICAL_CONTROLLER_FRAME_CORRECTION,
  PHONE_RIGHT_EDGE_AXIS,
  PHONE_SCREEN_NORMAL_AXIS,
  PHONE_TO_GAME_BASIS,
  PHONE_TOP_EDGE_AXIS,
  relativeOrientation,
  rootRelativePointToWorld,
  screenOrientationCorrection,
  GAMEPLAY_BLADE_FORWARD_AXIS,
  simulatedPhonePose,
  zxyEulerToQuaternion,
} from "./MotionMath.ts";

const DEGREES_TO_RADIANS = Math.PI / 180;
const PHONE_CONTROLLER_URL = new URL("./PhoneMotionController.ts", import.meta.url);
const MOTION_MATH_URL = new URL("./MotionMath.ts", import.meta.url);

function expectedZxy(alpha: number, beta: number, gamma: number): Quaternion {
  return Quaternion.RotationAxis(
    new Vector3(0, 0, 1),
    alpha * DEGREES_TO_RADIANS,
  )
    .multiply(
      Quaternion.RotationAxis(
        new Vector3(1, 0, 0),
        beta * DEGREES_TO_RADIANS,
      ),
    )
    .multiply(
      Quaternion.RotationAxis(
        new Vector3(0, 1, 0),
        gamma * DEGREES_TO_RADIANS,
      ),
    )
    .normalize();
}

function assertSameRotation(actual: Quaternion, expected: Quaternion, label: string): void {
  const dot =
    actual.x * expected.x +
    actual.y * expected.y +
    actual.z * expected.z +
    actual.w * expected.w;
  assert.ok(Math.abs(Math.abs(dot) - 1) < 1e-6, `${label}: dot=${dot}`);
}

test("DeviceOrientation matches intrinsic ZXY composition", () => {
  const cases = [
    [0, 0, 0],
    [35, 0, 0],
    [0, -22, 0],
    [0, 0, 41],
    [25, -18, 33],
    [-63, 27, 48],
    [120, -35, 67],
  ] as const;

  for (const [alpha, beta, gamma] of cases) {
    assertSameRotation(
      zxyEulerToQuaternion(alpha, beta, gamma),
      expectedZxy(alpha, beta, gamma),
      `${alpha}/${beta}/${gamma}`,
    );
  }
});

test("screen orientation correction is applied separately from sensor ZXY", () => {
  const sensor = expectedZxy(25, -18, 33);
  const expected = screenOrientationCorrection(90).multiply(sensor).normalize();
  const actual = deviceOrientationToQuaternion(25, -18, 33, 90);
  assertSameRotation(actual, expected, "screen angle 90");
  assertSameRotation(
    deviceOrientationToQuaternion(25, -18, 33, 0),
    sensor,
    "screen angle 0",
  );
});

function swordDirection(phoneDelta: Quaternion, localAxis: Vector3): Vector3 {
  const neutral = neutralSwordRotation(new Vector3(1, 0, 0));
  const rotation = neutral.multiply(phoneDeltaToGameDelta(phoneDelta));
  return localAxis
    .rotateByQuaternionToRef(rotation, new Vector3())
    .normalize();
}

function rotationDistance(first: Quaternion, second: Quaternion): number {
  const dot = Math.max(-1, Math.min(1, Math.abs(
    first.x * second.x + first.y * second.y + first.z * second.z + first.w * second.w,
  )));
  return 2 * Math.acos(dot);
}

test("the explicit phone basis maps neutral blade forward", () => {
  const blade = swordDirection(Quaternion.Identity(), GAMEPLAY_BLADE_FORWARD_AXIS);
  assert.ok(blade.equalsWithEpsilon(new Vector3(1, 0, 0), 1e-6));
});

test("the screen-up phone frame is right-handed and maps through one proper alignment", () => {
  assert.ok(PHONE_CONTROLLER_FRAME.right.equals(PHONE_RIGHT_EDGE_AXIS));
  assert.ok(PHONE_CONTROLLER_FRAME.forward.equals(PHONE_TOP_EDGE_AXIS));
  assert.ok(PHONE_CONTROLLER_FRAME.up.equals(PHONE_SCREEN_NORMAL_AXIS));
  const phoneRight = PHONE_RIGHT_EDGE_AXIS.rotateByQuaternionToRef(
    PHONE_TO_GAME_BASIS,
    new Vector3(),
  );
  const phoneTop = PHONE_TOP_EDGE_AXIS.rotateByQuaternionToRef(
    PHONE_TO_GAME_BASIS,
    new Vector3(),
  );
  const phoneScreen = PHONE_SCREEN_NORMAL_AXIS.rotateByQuaternionToRef(
    PHONE_TO_GAME_BASIS,
    new Vector3(),
  );

  assert.ok(phoneRight.equalsWithEpsilon(new Vector3(-1, 0, 0), 1e-6));
  assert.ok(phoneTop.equalsWithEpsilon(new Vector3(0, -1, 0), 1e-6));
  assert.ok(phoneScreen.equalsWithEpsilon(new Vector3(0, 0, 1), 1e-6));
  assert.ok(
    Vector3.Cross(phoneRight, phoneTop).equalsWithEpsilon(phoneScreen, 1e-6),
    "basis remains right-handed",
  );
  assert.ok(Math.abs(PHONE_TO_GAME_BASIS.length() - 1) < 1e-6);
});

test("the physical correction is one proper half-turn around the phone right edge", () => {
  assertSameRotation(
    PHYSICAL_CONTROLLER_FRAME_CORRECTION,
    Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, Math.PI),
    "physical frame correction",
  );
  const right = PHONE_RIGHT_EDGE_AXIS.rotateByQuaternionToRef(
    PHYSICAL_CONTROLLER_FRAME_CORRECTION,
    new Vector3(),
  );
  const top = PHONE_TOP_EDGE_AXIS.rotateByQuaternionToRef(
    PHYSICAL_CONTROLLER_FRAME_CORRECTION,
    new Vector3(),
  );
  const screen = PHONE_SCREEN_NORMAL_AXIS.rotateByQuaternionToRef(
    PHYSICAL_CONTROLLER_FRAME_CORRECTION,
    new Vector3(),
  );
  assert.ok(right.equalsWithEpsilon(PHONE_RIGHT_EDGE_AXIS, 1e-6));
  assert.ok(top.equalsWithEpsilon(PHONE_TOP_EDGE_AXIS.scale(-1), 1e-6));
  assert.ok(screen.equalsWithEpsilon(PHONE_SCREEN_NORMAL_AXIS.scale(-1), 1e-6));
});

test("physical edge rotations preserve vertical and correct horizontal direction", () => {
  const angle = Math.PI / 4;
  const up = swordDirection(
    Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, angle),
    GAMEPLAY_BLADE_FORWARD_AXIS,
  );
  const down = swordDirection(
    Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, -angle),
    GAMEPLAY_BLADE_FORWARD_AXIS,
  );
  const left = swordDirection(
    Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, angle),
    GAMEPLAY_BLADE_FORWARD_AXIS,
  );
  const right = swordDirection(
    Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, -angle),
    GAMEPLAY_BLADE_FORWARD_AXIS,
  );

  assert.ok(up.y > 0.4, `up y=${up.y}`);
  assert.ok(down.y < -0.4, `down y=${down.y}`);
  assert.ok(left.z > 0.4, `left z=${left.z}`);
  assert.ok(right.z < -0.4, `right z=${right.z}`);
});

test("screen-up simulated poses use the new physical phone axes", () => {
  const angle = Math.PI / 4;
  const syntheticUp = swordDirection(
    simulatedPhonePose("up", angle),
    GAMEPLAY_BLADE_FORWARD_AXIS,
  );
  const syntheticDown = swordDirection(
    simulatedPhonePose("down", angle),
    GAMEPLAY_BLADE_FORWARD_AXIS,
  );
  assert.ok(syntheticUp.y > 0.4, `synthetic up y=${syntheticUp.y}`);
  assert.ok(syntheticDown.y < -0.4, `synthetic down y=${syntheticDown.y}`);
  assert.ok(
    swordDirection(simulatedPhonePose("left", angle), GAMEPLAY_BLADE_FORWARD_AXIS).z > 0.4,
  );
  assert.ok(
    swordDirection(simulatedPhonePose("right", angle), GAMEPLAY_BLADE_FORWARD_AXIS).z < -0.4,
  );
});

test("the calibrated phone publisher preserves the full relative quaternion", () => {
  const source = readFileSync(PHONE_CONTROLLER_URL, "utf8");
  const mathSource = readFileSync(MOTION_MATH_URL, "utf8");
  assert.doesNotMatch(source, /correctPhysicalDevicePitch/);
  assert.doesNotMatch(mathSource, /correctPhysicalDevicePitch/);
  assert.match(mathSource, /multiply\(PHYSICAL_CONTROLLER_FRAME_CORRECTION\)/);
  assert.match(source, /relativeOrientation\(this\.calibrationReference, this\.rawQuaternion\)/);
  assert.match(source, /calibrationReferenceQuaternion/);
  assert.match(source, /rawQuaternion/);
});

test("recenter identity removes arbitrary absolute starting orientation", () => {
  const references = [
    zxyEulerToQuaternion(130, 65, -22),
    Quaternion.RotationYawPitchRoll(-0.8, 0.31, 1.1).normalize(),
    Quaternion.RotationAxis(new Vector3(0.3, 0.7, -0.2).normalize(), 1.2),
  ];
  for (const reference of references) {
    assertSameRotation(
      relativeOrientation(reference, reference),
      Quaternion.Identity(),
      "recenter identity",
    );
    assertSameRotation(
      phoneDeltaToGameDelta(relativeOrientation(reference, reference)),
      Quaternion.Identity(),
      "recenter game identity",
    );
  }
});

test("physical clockwise and counterclockwise roll signs are corrected", () => {
  const angle = Math.PI / 5;
  const clockwise = phoneDeltaToGameDelta(
    Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, angle),
  );
  const counterclockwise = phoneDeltaToGameDelta(
    Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, -angle),
  );
  assertSameRotation(
    clockwise,
    Quaternion.RotationAxis(GAMEPLAY_BLADE_FORWARD_AXIS, -angle),
    "clockwise phone roll",
  );
  assertSameRotation(
    counterclockwise,
    Quaternion.RotationAxis(GAMEPLAY_BLADE_FORWARD_AXIS, angle),
    "counterclockwise phone roll",
  );
});

test("phone roll rotates the sword frame around forward without changing blade direction", () => {
  const angle = Math.PI / 5;
  const neutralForward = swordDirection(Quaternion.Identity(), GAMEPLAY_BLADE_FORWARD_AXIS);
  const neutralUp = swordDirection(Quaternion.Identity(), GAMEPLAY_BLADE_UP_AXIS);
  const rolledForward = swordDirection(
    Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, angle),
    GAMEPLAY_BLADE_FORWARD_AXIS,
  );
  const rolledUp = swordDirection(
    Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, angle),
    GAMEPLAY_BLADE_UP_AXIS,
  );
  assert.ok(neutralForward.equalsWithEpsilon(rolledForward, 1e-6));
  assert.ok(Vector3.Dot(neutralUp, rolledUp) < 0.95);

  const combined = phoneDeltaToGameDelta(
    Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, -0.55)
      .multiply(Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, 0.35))
      .multiply(Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, 0.42))
      .normalize(),
  );
  for (const value of [combined.x, combined.y, combined.z, combined.w]) {
    assert.equal(Number.isFinite(value), true);
  }
  assert.ok(Math.abs(combined.length() - 1) < 1e-6);
});

test("all four physical diagonals retain both intended components", () => {
  const angle = Math.PI / 5;
  const cases = [
    { name: "up-right", vertical: 1, horizontal: -1, ySign: 1, zSign: -1 },
    { name: "up-left", vertical: 1, horizontal: 1, ySign: 1, zSign: 1 },
    { name: "down-right", vertical: -1, horizontal: -1, ySign: -1, zSign: -1 },
    { name: "down-left", vertical: -1, horizontal: 1, ySign: -1, zSign: 1 },
  ];

  for (const testCase of cases) {
    const diagonal = Quaternion.RotationAxis(
      PHONE_RIGHT_EDGE_AXIS,
      testCase.vertical * angle,
    )
      .multiply(Quaternion.RotationAxis(
        PHONE_SCREEN_NORMAL_AXIS,
        testCase.horizontal * angle * 0.8,
      ))
      .normalize();
    const blade = swordDirection(diagonal, GAMEPLAY_BLADE_FORWARD_AXIS);
    assert.ok(
      testCase.ySign * blade.y > 0.2,
      `${testCase.name} vertical y=${blade.y}`,
    );
    assert.ok(
      testCase.zSign * blade.z > 0.2,
      `${testCase.name} horizontal z=${blade.z}`,
    );
  }
});

test("arbitrary pitch, yaw, and roll remains finite and normalized", () => {
  const arbitrary = Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, -0.91)
    .multiply(Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, 0.67))
    .multiply(Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, 1.13))
    .normalize();
  const mapped = phoneDeltaToGameDelta(arbitrary);
  assert.ok([mapped.x, mapped.y, mapped.z, mapped.w].every(Number.isFinite));
  assert.ok(Math.abs(mapped.length() - 1) < 1e-6);
});

test("marker-derived frame alignment agrees with direct full-quaternion conversion", () => {
  const neutral = neutralSwordRotation(new Vector3(1, 0, 0));
  const markerFrame = orthonormalFrame(
    new Vector3(0.15, 0.97, -0.08),
    new Vector3(-0.05, 0.12, 0.99),
  );
  const basis = derivePhoneToGameplayBasis(
    neutral,
    markerFrame,
    new Vector3(1, 0, 0),
  );
  const delta = Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, 0.31)
    .multiply(Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, -0.22))
    .multiply(Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, 0.17))
    .normalize();
  const expected = basis.clone().multiply(delta).multiply(basis.clone().invert()).normalize();
  assertSameRotation(phoneDeltaToGameDelta(delta, basis), expected, "frame alignment");
  assert.ok(Math.abs(basis.length() - 1) < 1e-6);
});

test("diagonal motion remains a single continuous quaternion", () => {
  const angles = [0, 5, 10, 20, 30, 45].map((value) => value * DEGREES_TO_RADIANS);
  const orientations = angles.map((angle) =>
    Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, angle)
      .multiply(Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, angle))
      .multiply(Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, angle * 0.18))
      .normalize(),
  );
  let previousMapped = phoneDeltaToGameDelta(orientations[0]);
  let previousBlade = swordDirection(orientations[0], GAMEPLAY_BLADE_FORWARD_AXIS);
  for (let index = 1; index < orientations.length; index += 1) {
    const mapped = phoneDeltaToGameDelta(orientations[index]);
    const blade = swordDirection(orientations[index], GAMEPLAY_BLADE_FORWARD_AXIS);
    assert.ok(rotationDistance(previousMapped, mapped) < 0.6, `step ${index} quaternion jump`);
    assert.ok(Vector3.Dot(previousBlade, blade) > 0.9, `step ${index} blade reversal`);
    assert.ok([mapped.x, mapped.y, mapped.z, mapped.w, blade.x, blade.y, blade.z].every(Number.isFinite));
    previousMapped = mapped;
    previousBlade = blade;
  }
});

test("the opposite diagonal is also continuous", () => {
  const angles = [0, 5, 10, 20, 30, 45].map((value) => value * DEGREES_TO_RADIANS);
  const orientations = angles.map((angle) =>
    Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, -angle)
      .multiply(Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, -angle))
      .multiply(Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, -angle * 0.18))
      .normalize(),
  );
  let previousMapped = phoneDeltaToGameDelta(orientations[0]);
  let previousBlade = swordDirection(orientations[0], GAMEPLAY_BLADE_FORWARD_AXIS);
  for (let index = 1; index < orientations.length; index += 1) {
    const mapped = phoneDeltaToGameDelta(orientations[index]);
    const blade = swordDirection(orientations[index], GAMEPLAY_BLADE_FORWARD_AXIS);
    assert.ok(rotationDistance(previousMapped, mapped) < 0.6, `step ${index} quaternion jump`);
    assert.ok(Vector3.Dot(previousBlade, blade) > 0.9, `step ${index} blade reversal`);
    previousMapped = mapped;
    previousBlade = blade;
  }
});

test("the same physical delta maps identically after arbitrary calibration poses", () => {
  const physicalDelta = Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, 0.24)
    .multiply(Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, -0.19))
    .multiply(Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, 0.13))
    .normalize();
  const references = [
    zxyEulerToQuaternion(15, -40, 72),
    zxyEulerToQuaternion(-130, 22, 11),
    Quaternion.RotationYawPitchRoll(0.4, -0.7, 1.2).normalize(),
  ];
  const expectedMapped = phoneDeltaToGameDelta(physicalDelta);
  for (const reference of references) {
    const current = reference.clone().multiply(physicalDelta).normalize();
    const relative = relativeOrientation(reference, current);
    assertSameRotation(relative, physicalDelta, "calibrated physical delta");
    assertSameRotation(phoneDeltaToGameDelta(relative), expectedMapped, "calibrated game delta");
  }
});

test("simulated pose names use the same physical phone axes", () => {
  const angle = Math.PI / 5;
  const up = simulatedPhonePose("up", angle);
  const left = simulatedPhonePose("left", angle);
  const rollRight = simulatedPhonePose("rollRight", angle);
  assertSameRotation(
    up,
    Quaternion.RotationAxis(PHONE_RIGHT_EDGE_AXIS, angle),
    "simulated up",
  );
  assertSameRotation(
    left,
    Quaternion.RotationAxis(PHONE_SCREEN_NORMAL_AXIS, angle),
    "simulated left",
  );
  assertSameRotation(
    rollRight,
    Quaternion.RotationAxis(PHONE_TOP_EDGE_AXIS, angle),
    "simulated roll right",
  );
});

test("root-relative grip anchors translate with a fighter without changing orientation", () => {
  const point = rootRelativePointToWorld(
    new Vector3(2, 3, 4),
    Quaternion.RotationAxis(Vector3.Up(), Math.PI / 2),
    new Vector3(1, 0, 0),
  );
  assert.ok(point.equalsWithEpsilon(new Vector3(2, 3, 3), 1e-6));
});
