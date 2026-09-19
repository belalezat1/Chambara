import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Quaternion, Vector3 } from "@babylonjs/core";

import {
  composeTorsoFollowRotation,
  quaternionAngularDistance,
} from "./TorsoFollowMath.ts";

const BABYLON_GAME_URL = new URL("../BabylonGame.ts", import.meta.url);

test("torso follow changes the rendered bone rotation without changing the base target", () => {
  const animationRotation = Quaternion.RotationYawPitchRoll(0.18, -0.12, 0.24).normalize();
  const followed = composeTorsoFollowRotation(
    animationRotation,
    0.42,
    -0.31,
    0.25,
    0.18,
    Vector3.Right(),
    true,
  );
  const disabled = composeTorsoFollowRotation(
    animationRotation,
    0.42,
    -0.31,
    0.25,
    0.18,
    Vector3.Right(),
    false,
  );
  assert.ok(quaternionAngularDistance(animationRotation, followed) > 0.01);
  assert.ok(quaternionAngularDistance(animationRotation, disabled) < 1e-7);
});

test("torso follow has no cumulative rotation drift across repeated frames", () => {
  const animationRotation = Quaternion.RotationYawPitchRoll(-0.25, 0.16, -0.08).normalize();
  const expected = composeTorsoFollowRotation(
    animationRotation,
    -0.48,
    0.38,
    0.25,
    0.18,
    Vector3.Left(),
    true,
  );
  for (let frame = 0; frame < 2_000; frame += 1) {
    // Every frame starts from the animation sample, not the previous result.
    const actual = composeTorsoFollowRotation(
      animationRotation,
      -0.48,
      0.38,
      0.25,
      0.18,
      Vector3.Left(),
      true,
    );
    assert.ok(
      quaternionAngularDistance(actual, expected) < 1e-7,
      `frame ${frame} drifted`,
    );
  }
});

test("disabling torso follow restores each animation-only sample", () => {
  const samples = [
    Quaternion.Identity(),
    Quaternion.RotationYawPitchRoll(0.3, -0.2, 0.1).normalize(),
    Quaternion.RotationYawPitchRoll(-0.7, 0.4, -0.25).normalize(),
  ];
  for (const sample of samples) {
    const restored = composeTorsoFollowRotation(
      sample,
      0.4,
      0.3,
      0.25,
      0.18,
      Vector3.Right(),
      false,
    );
    assert.ok(quaternionAngularDistance(restored, sample) < 1e-7);
  }
});

test("Babylon prepares animation before torso follow and arm IK", () => {
  const source = readFileSync(BABYLON_GAME_URL, "utf8");
  const prepare = source.indexOf("this.poseRig.skeleton.prepare(true)");
  const follow = source.indexOf("this.applyTorsoFollow", prepare);
  const ik = source.indexOf("this.applyArmIk", follow);
  assert.ok(prepare >= 0 && follow > prepare && ik > follow, "presentation ordering");
  assert.match(source, /setTorsoFollowEnabled\(enabled: boolean\)/);
  assert.match(source, /composeTorsoFollowRotation/);
  assert.match(source, /torsoFollowDriftRadians/);
  assert.match(source, /captureBoneLocalRotation/);
  assert.match(source, /if \(!this\.torsoFollowEnabled\)/);
  const followStart = source.indexOf("private applyBoneFollow");
  const followEnd = source.indexOf("\n  }", followStart);
  assert.ok(followStart >= 0 && followEnd > followStart, "local follow setter found");
  const followMethod = source.slice(followStart, followEnd);
  assert.match(followMethod, /setRotationQuaternion\(result, Space\.LOCAL\)/);
  assert.doesNotMatch(followMethod, /Space\.WORLD/);
});
