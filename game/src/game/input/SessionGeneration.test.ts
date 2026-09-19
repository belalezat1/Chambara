import assert from "node:assert/strict";
import test from "node:test";

import { Quaternion, Vector3 } from "@babylonjs/core";

import { SessionSequenceAdmission } from "./MotionTypes.ts";
import { WeaponTarget } from "./WeaponTarget.ts";

test("a new phone session accepts sequence zero and rejects old-session packets", () => {
  const hostAdmission = new SessionSequenceAdmission();
  const babylonAdmission = new SessionSequenceAdmission();

  for (const admission of [hostAdmission, babylonAdmission]) {
    for (let sequence = 0; sequence <= 100; sequence += 1) {
      assert.equal(admission.accept(7, sequence), true, `old session seq ${sequence}`);
    }
    assert.equal(admission.accept(7, 100), false, "duplicate old sequence");
    assert.equal(admission.accept(8, 0), true, "new session sequence zero");
    assert.equal(admission.accept(7, 101), false, "stale old session packet");
    assert.equal(admission.accept(8, 1), true, "new session continues");
    assert.equal(admission.generation, 8);
    assert.equal(admission.lastSequence, 1);
  }
});

test("reconnected phone sequence zero reaches the sword target", () => {
  const host = new SessionSequenceAdmission();
  const babylon = new SessionSequenceAdmission();
  const target = new WeaponTarget();
  const restPosition = new Vector3(1, 2, 3);
  const firstRotation = Quaternion.Identity();
  const nextRotation = Quaternion.RotationAxis(Vector3.Up(), 0.7);

  for (let sequence = 0; sequence <= 100; sequence += 1) {
    assert.equal(host.accept(21, sequence), true);
    assert.equal(babylon.accept(21, sequence), true);
  }
  target.setController(Vector3.Zero(), restPosition, firstRotation, 21, 100);

  assert.equal(host.accept(22, 0), true, "host admits new phone seq 0");
  assert.equal(babylon.accept(22, 0), true, "Babylon admits new phone seq 0");
  target.setController(Vector3.Zero(), restPosition, nextRotation, 22, 0);

  assert.equal(target.sessionGeneration, 22);
  assert.equal(target.sequence, 0);
  assert.notDeepEqual(target.snapshot().worldRotation, [0, 0, 0, 1]);
  assert.equal(host.accept(21, 101), false, "old phone cannot replace current input");
  assert.equal(babylon.accept(21, 101), false, "Babylon rejects old phone input");
});
