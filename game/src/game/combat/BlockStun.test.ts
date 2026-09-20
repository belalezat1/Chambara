import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BLOCK_ATTACKER_STUN_SECONDS,
  BLOCK_ANGLE_DEG,
  HIT_INVULN_MS,
  STUN_SECONDS,
} from "./CombatConstants.ts";
import { resolveCombat } from "./CombatResolver.ts";
import { advanceSlashArming } from "./CombatSlashArming.ts";
import { PREFERRED_SPACING } from "./CombatConstants.ts";

function near(actual: number, expected: number, eps = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);
}

test("block stun constants: attacker 2.5s, hit stun ~1.0s", () => {
  assert.equal(BLOCK_ATTACKER_STUN_SECONDS, 2.5);
  near(STUN_SECONDS, 1.0);
  // Invuln must not cover the full block-stun window (retaliation must land).
  assert.ok(HIT_INVULN_MS < BLOCK_ATTACKER_STUN_SECONDS * 1000);
  assert.ok(HIT_INVULN_MS <= 200);
});

test("after block, blocker is not stunned and can arm a slash immediately", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const guardAngle = (BLOCK_ANGLE_DEG * 0.5 * Math.PI) / 180;
  const player = {
    identityHex: "attacker",
    rootX: left,
    slashProgress: 0.45 as number | null,
    slashAngle: 0 as number | null,
    blocking: false,
    blockingBeforeWindow: false,
    onSoftEdge: false,
    invulnerable: false,
    bladeTip: { x: right - 0.2, y: 1.1, z: 0 },
    bladeBase: { x: left + 0.3, y: 1.0, z: 0 },
    guardX: 0,
    guardY: 1,
  };
  const dummy = {
    identityHex: "blocker",
    rootX: right,
    slashProgress: null as number | null,
    slashAngle: null as number | null,
    blocking: true,
    blockingBeforeWindow: true,
    onSoftEdge: false,
    invulnerable: false,
    bladeTip: { x: right, y: 1.2, z: 0.2 },
    bladeBase: { x: right, y: 1.0, z: 0.05 },
    guardX: Math.cos(guardAngle),
    guardY: Math.sin(guardAngle),
  };

  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "blocked");
  // Resolver does not stun the blocker (no invuln / displacement on defender).
  near(result.dummyRootX, right);

  // Blocker free: arming accepts a slash when not stunned (blocker never gets stun).
  // Simulates release within ~100ms: blocking=false, stunned=false.
  const arming = advanceSlashArming({
    slashCount: 2,
    lastSlashCount: 1,
    blocking: false,
    stunned: false,
    slashAccepted: true,
  });
  assert.equal(arming.armed, true);
  assert.equal(arming.lastSlashCount, 2);

  // Attacker remains stunned for BLOCK_ATTACKER_STUN_SECONDS (presentation timer).
  const attackerArming = advanceSlashArming({
    slashCount: 2,
    lastSlashCount: 1,
    blocking: false,
    stunned: true,
    slashAccepted: true,
  });
  assert.equal(attackerArming.armed, false);
});

test("attacker block-stun invuln is short — retaliation can connect mid-stun", () => {
  // Presentation contract: after HIT_INVULN_MS the stunned attacker is hittable
  // for the remainder of BLOCK_ATTACKER_STUN_SECONDS.
  const stunMs = BLOCK_ATTACKER_STUN_SECONDS * 1000;
  assert.ok(HIT_INVULN_MS * 4 < stunMs);
  const remainingHittableMs = stunMs - HIT_INVULN_MS;
  assert.ok(remainingHittableMs >= 2000);
});
