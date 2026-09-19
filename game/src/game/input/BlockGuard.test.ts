import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCK_AIM_Y,
  approachBlockBlend,
  blockBladeDirection,
  blockGuardPoseOffsets,
  lerpGuardOffsets,
  nlerpBladeDirection,
} from "./BlockGuard.ts";
import { guardPoseOffsets } from "./CircleSword.ts";
import { isControllerSample } from "./MotionTypes.ts";

const near = (actual: number, expected: number, eps = 0.0001) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test("relay validates optional blocking flag", () => {
  const sample = {
    sessionGeneration: 1,
    sequence: 0,
    timestamp: 0,
    quaternion: [0, 0, 0, 1],
    calibrated: true,
  };
  assert.equal(isControllerSample(sample), true);
  assert.equal(isControllerSample({ ...sample, blocking: true }), true);
  assert.equal(isControllerSample({ ...sample, blocking: false }), true);
  for (const blocking of [1, "true", null]) {
    assert.equal(isControllerSample({ ...sample, blocking }), false);
  }
});

test("block guard sits at waist with modest lateral sweep", () => {
  const center = blockGuardPoseOffsets({ x: 0, y: BLOCK_AIM_Y });
  const left = blockGuardPoseOffsets({ x: -1, y: BLOCK_AIM_Y });
  const right = blockGuardPoseOffsets({ x: 1, y: BLOCK_AIM_Y });
  assert.ok(center.vertical <= 0);
  assert.ok(center.vertical >= -0.15);
  assert.ok(left.lateral <= -0.25);
  assert.ok(left.lateral >= -0.4);
  assert.ok(right.lateral >= 0.25);
  assert.ok(right.lateral <= 0.4);
  near(center.lateral, 0);
});

test("block blade tip is pure vertical at center and pure horizontal at ±1", () => {
  const right = { x: 0, y: 0, z: 1 };
  const forward = { x: 1, y: 0, z: 0 };
  const center = blockBladeDirection(right, forward, 0);
  near(center.y, 1);
  near(center.x, 0);
  near(center.z, 0);

  const left = blockBladeDirection(right, forward, -1);
  near(left.y, 0);
  assert.ok(Math.abs(left.z) > 0.99, `full left should be lateral-dominant, z=${left.z}`);
  assert.ok(left.z < 0);

  const rightDir = blockBladeDirection(right, forward, 1);
  near(rightDir.y, 0);
  assert.ok(Math.abs(rightDir.z) > 0.99);
  assert.ok(rightDir.z > 0);

  // No forward bias required — direction lives in the up/right plane.
  near(center.x, 0);
  near(left.x, 0);
  near(rightDir.x, 0);
});

test("block blend approaches 1 while held and 0 on release", () => {
  let blend = 0;
  blend = approachBlockBlend(blend, true, 0.1);
  assert.ok(blend > 0 && blend < 1);
  for (let i = 0; i < 40; i++) blend = approachBlockBlend(blend, true, 0.05);
  near(blend, 1, 0.01);
  for (let i = 0; i < 40; i++) blend = approachBlockBlend(blend, false, 0.05);
  near(blend, 0, 0.01);
});

test("lerp/nlerp at 0 and 1 match endpoints; mid is between", () => {
  const ready = guardPoseOffsets({ x: 0, y: 0 });
  const block = blockGuardPoseOffsets({ x: 0, y: BLOCK_AIM_Y });
  const at0 = lerpGuardOffsets(ready, block, 0);
  const at1 = lerpGuardOffsets(ready, block, 1);
  const mid = lerpGuardOffsets(ready, block, 0.5);
  near(at0.vertical, ready.vertical);
  near(at1.vertical, block.vertical);
  assert.ok(mid.vertical !== ready.vertical);
  assert.ok(mid.vertical !== block.vertical);

  const right = { x: 0, y: 0, z: 1 };
  const forward = { x: 1, y: 0, z: 0 };
  const readyDir = { x: 1, y: 0, z: 0 };
  const blockDir = blockBladeDirection(right, forward, 0);
  const d0 = nlerpBladeDirection(readyDir, blockDir, 0);
  const d1 = nlerpBladeDirection(readyDir, blockDir, 1);
  const dm = nlerpBladeDirection(readyDir, blockDir, 0.5);
  near(d0.x, readyDir.x);
  near(d1.y, blockDir.y);
  assert.ok(dm.y > 0 && dm.y < 1);
  assert.ok(dm.x > 0 && dm.x < 1);
});
