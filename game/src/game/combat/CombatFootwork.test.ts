import assert from "node:assert/strict";
import test from "node:test";

import { HIT_WINDOW_START, LUNGE_M, PREFERRED_SPACING, STRIKE_GAP_M } from "./CombatConstants.ts";
import {
  lungeDistanceToStrikeGap,
  lungeFactorFromSlashProgress,
  lungeTargetX,
  regroupTargets,
  stepLungeRecover,
} from "./CombatFootwork.ts";

test("lunge factor ramps into the hit window then holds peak", () => {
  assert.equal(lungeFactorFromSlashProgress(null), 0);
  assert.equal(lungeFactorFromSlashProgress(0), 0);
  assert.ok(Math.abs(lungeFactorFromSlashProgress(HIT_WINDOW_START * 0.5)! - 0.5) < 1e-9);
  assert.equal(lungeFactorFromSlashProgress(HIT_WINDOW_START), 1);
  assert.equal(lungeFactorFromSlashProgress(0.5), 1);
  assert.equal(lungeFactorFromSlashProgress(0.9), 1);
});

test("lunge closes toward strike gap, capped by LUNGE_M", () => {
  const origin = -PREFERRED_SPACING / 2;
  const opponent = PREFERRED_SPACING / 2;
  const step = lungeDistanceToStrikeGap(origin, opponent);
  near(step, PREFERRED_SPACING - STRIKE_GAP_M);
  assert.ok(step <= LUNGE_M);
  assert.equal(lungeTargetX(origin, opponent, 0), origin);
  near(lungeTargetX(origin, opponent, 1), origin + step);
  near(lungeTargetX(origin, opponent, 0.5), origin + step * 0.5);
});

test("wider gap after knockback still closes toward strike range", () => {
  const origin = -1.0;
  const opponent = 1.6; // 2.6 m gap
  const step = lungeDistanceToStrikeGap(origin, opponent);
  // Capped by LUNGE_M when the raw close would exceed it.
  near(step, LUNGE_M);
  const lungedGap = Math.abs(opponent - lungeTargetX(origin, opponent, 1));
  assert.ok(lungedGap < 2.6 - 0.5);
  assert.ok(lungedGap >= STRIKE_GAP_M - 1e-6);
});

test("miss recover eases back to origin", () => {
  const origin = -1.2;
  const lunged = origin + lungeDistanceToStrikeGap(origin, 1.2);
  let x = lunged;
  for (let i = 0; i < 40; i += 1) {
    x = stepLungeRecover(x, origin, 1 / 60);
  }
  assert.ok(Math.abs(x - origin) < 0.02, `expected near origin, got ${x}`);
});

test("regroup preserves defender X and reseats attacker only", () => {
  const defenderX = 1.4;
  const attackerX = 0.5;
  const targets = regroupTargets(
    { playerX: attackerX, dummyX: defenderX },
    true,
  );
  near(targets.dummyX, defenderX);
  near(targets.playerX, defenderX - PREFERRED_SPACING);
  near(Math.abs(targets.dummyX - targets.playerX), PREFERRED_SPACING);

  const flipped = regroupTargets(
    { playerX: -1.4, dummyX: -0.4 },
    false,
  );
  near(flipped.playerX, -1.4);
  near(flipped.dummyX, -1.4 + PREFERRED_SPACING);
});

test("lunge at preferred spacing equals LUNGE_M budget (2.2 → 1.25 gap)", () => {
  near(PREFERRED_SPACING, 2.2);
  const origin = -PREFERRED_SPACING / 2;
  const opponent = PREFERRED_SPACING / 2;
  const step = lungeDistanceToStrikeGap(origin, opponent);
  near(step, LUNGE_M);
  near(Math.abs(opponent - lungeTargetX(origin, opponent, 1)), STRIKE_GAP_M);
});

function near(actual: number, expected: number, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);
}
