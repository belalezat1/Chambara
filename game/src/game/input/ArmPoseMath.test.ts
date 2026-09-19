import assert from "node:assert/strict";
import test from "node:test";

import { Vector3 } from "@babylonjs/core";

import { clampTwoBoneTarget } from "./ArmPoseMath.ts";

test("two-bone IK clamps unreachable targets to finite reach", () => {
  const result = clampTwoBoneTarget(
    Vector3.Zero(),
    new Vector3(100, 100, 100),
    0.45,
    0.40,
  );
  assert.equal(result.clamped, true);
  assert.equal(result.finite, true);
  assert.ok(result.target.length() < 0.9);
  assert.ok(result.target.length() > 0.1);
});

test("two-bone IK handles zero and non-finite targets without NaNs", () => {
  const cases = [
    Vector3.Zero(),
    new Vector3(Number.NaN, 0, 0),
    new Vector3(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0),
    new Vector3(-1000, 0, 0),
  ];

  for (const target of cases) {
    const result = clampTwoBoneTarget(new Vector3(1, 2, 3), target, 0.6, 0.5);
    assert.equal(result.finite, true);
    assert.equal(Number.isFinite(result.target.x), true);
    assert.equal(Number.isFinite(result.target.y), true);
    assert.equal(Number.isFinite(result.target.z), true);
  }
});

test("normal two-handed grip distances stay inside the reachable annulus", () => {
  const right = clampTwoBoneTarget(
    new Vector3(0.45, 1.05, 0),
    new Vector3(0.15, 1.02, 0.45),
    0.42,
    0.38,
  );
  const left = clampTwoBoneTarget(
    new Vector3(-0.45, 1.05, 0),
    new Vector3(-0.15, 1.02, 0.45),
    0.42,
    0.38,
  );

  assert.equal(right.finite, true);
  assert.equal(left.finite, true);
  assert.equal(right.clamped, false);
  assert.equal(left.clamped, false);
});
