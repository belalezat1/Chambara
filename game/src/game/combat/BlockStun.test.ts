import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCK_ATTACKER_STUN_SECONDS,
  PREFERRED_SPACING,
  STUN_SECONDS,
} from "./CombatConstants.ts";
import { resolveCombat, type FighterSnapshot } from "./CombatResolver.ts";

function fighter(
  partial: Partial<FighterSnapshot> & Pick<FighterSnapshot, "identityHex">,
): FighterSnapshot {
  return {
    blocking: false,
    blockingBeforeWindow: false,
    slashProgress: null,
    slashAngle: null,
    guardX: 1,
    guardY: 0,
    bladeTip: { x: 0, y: 1, z: 0 },
    bladeBase: { x: 0, y: 1, z: 0.2 },
    rootX: 0,
    onSoftEdge: false,
    invulnerable: false,
    ...partial,
  };
}

test("BLOCK_ATTACKER_STUN_SECONDS is 2.5 and longer than hit stun", () => {
  assert.equal(BLOCK_ATTACKER_STUN_SECONDS, 2.5);
  assert.ok(BLOCK_ATTACKER_STUN_SECONDS > STUN_SECONDS);
});

test("directional block returns blocked with attacker as actor (not defender)", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const player = fighter({
    identityHex: "attacker",
    rootX: left,
    slashProgress: 0.5,
    slashAngle: 0,
    bladeTip: { x: right, y: 1, z: 0 },
    bladeBase: { x: right - 0.4, y: 1, z: 0.1 },
  });
  const dummy = fighter({
    identityHex: "blocker",
    rootX: right,
    blocking: true,
    blockingBeforeWindow: true,
    guardX: 1,
    guardY: 0,
    bladeTip: { x: right - 0.3, y: 1, z: 0 },
    bladeBase: { x: right - 0.1, y: 1, z: 0.1 },
  });
  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result!.kind, "blocked");
  assert.equal(result!.actorIdentityHex, "attacker");
  assert.equal(result!.targetIdentityHex, "blocker");
});
