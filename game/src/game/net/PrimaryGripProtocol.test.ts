import assert from "node:assert/strict";
import test from "node:test";

import {
  clonePrimaryGripNetworkPose,
  isPrimaryGripNetworkPose,
  PrimaryGripSequenceAdmission,
  type PrimaryGripNetworkPose,
} from "./PrimaryGripProtocol.ts";

const valid: PrimaryGripNetworkPose = {
  type: "primary-grip",
  position: [1, 2, 3],
  rotation: [0, 0, 0, 1],
  sessionGeneration: 0,
  sequence: 4,
};

test("accepts a finite primary-grip pose and clones its tuples", () => {
  assert.equal(isPrimaryGripNetworkPose(valid), true);
  const clone = clonePrimaryGripNetworkPose(valid);
  assert.deepEqual(clone, valid);
  assert.notEqual(clone.position, valid.position);
  assert.notEqual(clone.rotation, valid.rotation);
});

test("admits only newer poses and restarts sequence ordering for a new session", () => {
  const admission = new PrimaryGripSequenceAdmission();
  assert.equal(admission.accept(valid), true);
  assert.equal(admission.accept(valid), false);
  assert.equal(admission.accept({ ...valid, sequence: 3 }), false);
  assert.equal(admission.accept({ ...valid, sequence: 5 }), true);
  assert.equal(admission.accept({ ...valid, sessionGeneration: 1, sequence: 0 }), true);
  assert.equal(admission.accept({ ...valid, sessionGeneration: 0, sequence: 99 }), false);
  admission.reset();
  assert.equal(admission.accept(valid), true);
});

test("rejects malformed, non-finite, and zero-rotation poses", () => {
  const invalid = [
    { ...valid, type: "weapon" },
    { ...valid, position: [1, 2] },
    { ...valid, position: [1, Number.NaN, 3] },
    { ...valid, rotation: [0, 0, 0, 0] },
    { ...valid, sessionGeneration: -1 },
    { ...valid, sequence: 1.5 },
  ];
  for (const pose of invalid) assert.equal(isPrimaryGripNetworkPose(pose), false);
});
