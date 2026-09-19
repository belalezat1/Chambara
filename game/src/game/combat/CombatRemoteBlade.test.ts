import assert from "node:assert/strict";
import test from "node:test";

import { bladeHitsBody } from "./CombatCollision.ts";
import { PREFERRED_SPACING, STRIKE_GAP_M } from "./CombatConstants.ts";
import { lungeTargetX, regroupTargets } from "./CombatFootwork.ts";
import { estimateRemoteBladePose, pickAttackerBladePose } from "./CombatRemoteBlade.ts";

const near = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test("remote seat tip without lunge misses at preferred spacing", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const blade = estimateRemoteBladePose({
    rootX: right,
    opponentX: left,
    slashProgress: 0.5,
    guardX: 0,
    guardY: 1,
  });
  assert.equal(bladeHitsBody(blade.base, blade.tip, left), false);
});

test("remote lunged tip toward opponent connects at preferred spacing", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const lunged = lungeTargetX(right, left, 1);
  near(Math.abs(lunged - left), STRIKE_GAP_M);
  const blade = estimateRemoteBladePose({
    rootX: lunged,
    opponentX: left,
    slashProgress: 0.5,
    guardX: 0,
    guardY: 1,
  });
  assert.equal(bladeHitsBody(blade.base, blade.tip, left), true);
});

test("remote follow-up after regroup still connects with lunged tip", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  // Dummy (right) attacked; knock/advance then reseat attacker (dummy).
  const afterHit = {
    playerX: left - 0.28,
    dummyX: right - 0.28,
  };
  const reseat = regroupTargets(afterHit, false);
  near(Math.abs(reseat.dummyX - reseat.playerX), PREFERRED_SPACING);

  const lunged = lungeTargetX(reseat.dummyX, reseat.playerX, 1);
  near(Math.abs(lunged - reseat.playerX), STRIKE_GAP_M);
  const blade = estimateRemoteBladePose({
    rootX: lunged,
    opponentX: reseat.playerX,
    slashProgress: 0.5,
    guardX: 0,
    guardY: 1,
  });
  assert.equal(bladeHitsBody(blade.base, blade.tip, reseat.playerX), true);
});

test("local lunged combat tip connects; observed off-axis visual tip would miss", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const lunged = lungeTargetX(left, right, 1);
  // Browser capture: mid-slash WeaponTarget tip pointed away from dummy.
  const visualTip = { x: -1.274, y: 1.223, z: -0.034 };
  const visualBase = { x: -0.366, y: 1.218, z: -0.034 };
  assert.equal(bladeHitsBody(visualBase, visualTip, right), false);

  const combat = estimateRemoteBladePose({
    rootX: lunged,
    opponentX: right,
    slashProgress: 0.5,
    guardX: 0,
    guardY: 1,
  });
  assert.equal(bladeHitsBody(combat.base, combat.tip, right), true);

  const picked = pickAttackerBladePose({
    rootX: lunged,
    opponentX: right,
    slashProgress: 0.5,
    guardX: 0,
    guardY: 1,
    physicalTip: visualTip,
    physicalBase: visualBase,
  });
  assert.equal(bladeHitsBody(picked.base, picked.tip, right), true);
});
