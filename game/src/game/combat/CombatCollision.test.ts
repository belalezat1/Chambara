import assert from "node:assert/strict";
import test from "node:test";

import {
  bladeHitsBody,
  bodyCapsuleAtRootX,
  distancePointToCapsule,
  distanceSquaredBetweenSegments,
  segmentIntersectsCapsule,
  strikeHitPadding,
} from "./CombatCollision.ts";
import {
  BODY_CAPSULE_RADIUS,
  LUNGE_M,
  PREFERRED_SPACING,
  STRIKE_REACH_BONUS,
} from "./CombatConstants.ts";
import { lungeTargetX, regroupTargets } from "./CombatFootwork.ts";

/** Root gap after a full preferred-spacing lunge (capped by LUNGE_M). */
const LUNGED_GAP_M = PREFERRED_SPACING - LUNGE_M;

test("segment distance is zero when segments touch", () => {
  const d = distanceSquaredBetweenSegments(
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  );
  assert.ok(d < 1e-8);
});

test("preferred spacing with lunge connects", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const px = lungeTargetX(left, right, 1);
  const tip = { x: px + 0.55, y: 1.15, z: 0.2 };
  const base = { x: px + 0.08, y: 1.0, z: 0.12 };
  assert.equal(bladeHitsBody(base, tip, right), true);
  near(Math.abs(right - px), LUNGED_GAP_M);
});

test("angled tip still connects via tip proximity", () => {
  const right = PREFERRED_SPACING / 2;
  // Shaft points mostly up; tip still near the defender seat.
  const tip = { x: right - 0.35, y: 1.6, z: 0.15 };
  const base = { x: right - 0.9, y: 0.9, z: 0.1 };
  assert.equal(bladeHitsBody(base, tip, right), true);
  const capsule = bodyCapsuleAtRootX(right);
  assert.ok(distancePointToCapsule(tip, capsule) <= capsule.radius + strikeHitPadding());
});

test("far idle miss without lunge", () => {
  const capsule = bodyCapsuleAtRootX(PREFERRED_SPACING / 2);
  const farTip = { x: -PREFERRED_SPACING / 2, y: 1.1, z: 0 };
  const farBase = { x: -PREFERRED_SPACING / 2 - 0.4, y: 1.0, z: 0.1 };
  assert.equal(
    segmentIntersectsCapsule(farBase, farTip, capsule, BODY_CAPSULE_RADIUS),
    false,
  );
  assert.ok(strikeHitPadding() > STRIKE_REACH_BONUS);
});

test("preferred spacing full lunge still connects under LUNGE_M cap", () => {
  near(PREFERRED_SPACING, 2.6);
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const px = lungeTargetX(left, right, 1);
  near(Math.abs(right - px), LUNGED_GAP_M);
  const tip = { x: px + 0.55, y: 1.15, z: 0.2 };
  const base = { x: px + 0.08, y: 1.0, z: 0.12 };
  assert.equal(bladeHitsBody(base, tip, right), true);
});

test("partial lunge tip can miss; full lunge tip connects", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const tipReach = 0.35;
  const partial = lungeTargetX(left, right, 0.35);
  const partialTip = { x: partial + tipReach, y: 1.15, z: 0.2 };
  const partialBase = { x: partial + 0.08, y: 1.0, z: 0.12 };
  // Early in the close, tip may still be short of the capsule.
  assert.equal(bladeHitsBody(partialBase, partialTip, right), false);

  const full = lungeTargetX(left, right, 1);
  near(Math.abs(right - full), LUNGED_GAP_M);
  const fullTip = { x: full + tipReach, y: 1.15, z: 0.2 };
  const fullBase = { x: full + 0.08, y: 1.0, z: 0.12 };
  assert.equal(bladeHitsBody(fullBase, fullTip, right), true);
});

test("after hit regroup, follow-up lunge tip still connects", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  // First connect at lunged gap, then knock/advance leave gap unchanged.
  const afterHitPlayer = left + LUNGE_M + 0.28;
  const afterHitDummy = right + 0.28;
  const reseat = regroupTargets(
    { playerX: afterHitPlayer, dummyX: afterHitDummy },
    true,
  );
  near(Math.abs(reseat.dummyX - reseat.playerX), PREFERRED_SPACING);

  const px = lungeTargetX(reseat.playerX, reseat.dummyX, 1);
  near(Math.abs(reseat.dummyX - px), LUNGED_GAP_M);
  const tip = { x: px + 0.55, y: 1.15, z: 0.2 };
  const base = { x: px + 0.08, y: 1.0, z: 0.12 };
  assert.equal(bladeHitsBody(base, tip, reseat.dummyX), true);
});

test("remote lunged tip toward opponent connects at preferred spacing", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const lungedDummy = lungeTargetX(right, left, 1);
  near(Math.abs(lungedDummy - left), LUNGED_GAP_M);
  // Production estimate lives in CombatRemoteBlade — covered there in detail.
  const tipReach = 0.25 + 0.5;
  const toward = Math.sign(left - lungedDummy) || -1;
  const tip = { x: lungedDummy + toward * tipReach, y: 1.05, z: 0.2 };
  const base = { x: lungedDummy + toward * 0.08, y: 1.0, z: 0.12 };
  assert.equal(bladeHitsBody(base, tip, left), true);
});

function near(actual: number, expected: number, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
}
