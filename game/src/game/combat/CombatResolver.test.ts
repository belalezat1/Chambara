import assert from "node:assert/strict";
import test from "node:test";

import {
  ADVANCE_M,
  ARENA_RADIUS,
  BLOCK_ANGLE_DEG,
  CLASH_BLADE_DIST,
  HIT_WINDOW_END,
  HIT_WINDOW_START,
  KNOCKBACK_M,
  PREFERRED_SPACING,
  STRIKE_GAP_M,
} from "./CombatConstants.ts";
import {
  applySoftEdgeKnockback,
  canSlashWhileBlocking,
  isDirectionalBlockSuccess,
  isInHitWindow,
  resolveCombat,
  type FighterSnapshot,
} from "./CombatResolver.ts";
import { lungeTargetX, regroupTargets } from "./CombatFootwork.ts";
import { bladeHitsBody } from "./CombatCollision.ts";

const near = (actual: number, expected: number, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

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

/** Player (left) attacking dummy (right): tip near defender root, mid-cut. */
function leftAttackingRight(overrides: {
  player?: Partial<FighterSnapshot>;
  dummy?: Partial<FighterSnapshot>;
} = {}): { player: FighterSnapshot; dummy: FighterSnapshot } {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const player = fighter({
    identityHex: "p1",
    rootX: left,
    slashProgress: 0.5,
    slashAngle: 0,
    bladeTip: { x: right, y: 1, z: 0 },
    bladeBase: { x: right - 0.4, y: 1, z: 0.1 },
    ...overrides.player,
  });
  const dummy = fighter({
    identityHex: "p2",
    rootX: right,
    guardX: 1,
    guardY: 0,
    bladeTip: { x: right - 0.3, y: 1, z: 0 },
    bladeBase: { x: right - 0.1, y: 1, z: 0.1 },
    ...overrides.dummy,
  });
  return { player, dummy };
}

test("hit window covers mid-cut only", () => {
  assert.equal(isInHitWindow(null), false);
  assert.equal(isInHitWindow(HIT_WINDOW_START - 0.01), false);
  assert.equal(isInHitWindow(HIT_WINDOW_START), true);
  assert.equal(isInHitWindow(0.5), true);
  assert.equal(isInHitWindow(HIT_WINDOW_END), true);
  assert.equal(isInHitWindow(HIT_WINDOW_END + 0.01), false);
});

test("no slash while block held", () => {
  assert.equal(canSlashWhileBlocking(true), false);
  assert.equal(canSlashWhileBlocking(false), true);

  const { player, dummy } = leftAttackingRight({
    player: { blocking: true, slashProgress: 0.5, slashAngle: 0 },
  });
  assert.equal(resolveCombat({ player, dummy }), null);
});

test("clean hit knocks defender out and advances attacker", () => {
  const { player, dummy } = leftAttackingRight();
  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "hit");
  assert.equal(result.actorIdentityHex, "p1");
  assert.equal(result.targetIdentityHex, "p2");
  assert.equal(result.winnerIdentityHex, null);
  near(result.dummyRootX, dummy.rootX + KNOCKBACK_M);
  near(result.playerRootX, player.rootX + ADVANCE_M);
});

test("successful directional block knocks attacker", () => {
  const guardAngle = (BLOCK_ANGLE_DEG * 0.5 * Math.PI) / 180;
  const { player, dummy } = leftAttackingRight({
    dummy: {
      blocking: true,
      blockingBeforeWindow: true,
      guardX: Math.cos(guardAngle),
      guardY: Math.sin(guardAngle),
    },
  });
  assert.equal(
    isDirectionalBlockSuccess(dummy.guardX, dummy.guardY, player.slashAngle!),
    true,
  );

  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "blocked");
  assert.equal(result.actorIdentityHex, "p1");
  assert.equal(result.targetIdentityHex, "p2");
  near(result.playerRootX, player.rootX - KNOCKBACK_M);
  near(result.dummyRootX, dummy.rootX);
});

test("wrong block angle fails into a normal hit", () => {
  const badGuard = ((BLOCK_ANGLE_DEG + 15) * Math.PI) / 180;
  const { player, dummy } = leftAttackingRight({
    dummy: {
      blocking: true,
      blockingBeforeWindow: true,
      guardX: Math.cos(badGuard),
      guardY: Math.sin(badGuard),
    },
  });
  assert.equal(
    isDirectionalBlockSuccess(dummy.guardX, dummy.guardY, player.slashAngle!),
    false,
  );

  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "hit");
});

test("block held only after hit window opens does not count", () => {
  const { player, dummy } = leftAttackingRight({
    dummy: {
      blocking: true,
      blockingBeforeWindow: false,
      guardX: 1,
      guardY: 0,
    },
  });
  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "hit");
});

test("clash when both slash in window with close blades", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const mid = 0;
  const player = fighter({
    identityHex: "p1",
    rootX: left,
    slashProgress: 0.45,
    slashAngle: 0,
    bladeTip: { x: mid, y: 1, z: 0 },
    bladeBase: { x: mid - 0.2, y: 1, z: 0 },
  });
  const dummy = fighter({
    identityHex: "p2",
    rootX: right,
    slashProgress: 0.55,
    slashAngle: Math.PI,
    bladeTip: { x: mid + CLASH_BLADE_DIST * 0.4, y: 1, z: 0 },
    bladeBase: { x: mid + CLASH_BLADE_DIST * 0.4 + 0.2, y: 1, z: 0 },
  });

  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "clash");
  // Net: knockback outbound + advance inbound ≈ KNOCKBACK - ADVANCE outbound.
  near(result.playerRootX, left - KNOCKBACK_M + ADVANCE_M);
  near(result.dummyRootX, right + KNOCKBACK_M - ADVANCE_M);
});

test("soft edge clamps first push then rings out on second", () => {
  const first = applySoftEdgeKnockback(ARENA_RADIUS - 0.1, false, 1, 0, KNOCKBACK_M);
  assert.equal(first.ringedOut, false);
  assert.equal(first.onSoftEdge, true);
  near(first.rootX, ARENA_RADIUS);

  const second = applySoftEdgeKnockback(first.rootX, true, 1, 0, KNOCKBACK_M);
  assert.equal(second.ringedOut, true);
  assert.equal(second.onSoftEdge, true);
  near(second.rootX, ARENA_RADIUS);
});

test("hit into soft edge produces ringout with winner", () => {
  const { player, dummy } = leftAttackingRight({
    dummy: { rootX: ARENA_RADIUS, onSoftEdge: true },
  });
  player.bladeTip = { x: ARENA_RADIUS, y: 1, z: 0 };
  player.bladeBase = { x: ARENA_RADIUS - 0.4, y: 1, z: 0.1 };

  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "ringout");
  assert.equal(result.winnerIdentityHex, "p1");
});

test("chain knockbacks reach soft edge then ring out", () => {
  let dummyX = PREFERRED_SPACING / 2;
  let onSoftEdge = false;
  let ringed = false;
  let pushes = 0;
  while (pushes < 40 && !ringed) {
    pushes += 1;
    const knock = applySoftEdgeKnockback(dummyX, onSoftEdge, 1, 0, KNOCKBACK_M);
    dummyX = knock.rootX;
    onSoftEdge = knock.onSoftEdge;
    ringed = knock.ringedOut;
  }
  assert.equal(ringed, true);
  assert.ok(pushes >= 2);
  near(dummyX, ARENA_RADIUS);
});

test("i-frames skip hit and clash", () => {
  const hit = leftAttackingRight({ dummy: { invulnerable: true } });
  assert.equal(resolveCombat(hit), null);

  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const clash = resolveCombat({
    player: fighter({
      identityHex: "p1",
      rootX: left,
      slashProgress: 0.5,
      slashAngle: 0,
      bladeTip: { x: 0, y: 1, z: 0 },
      bladeBase: { x: -0.2, y: 1, z: 0 },
      invulnerable: true,
    }),
    dummy: fighter({
      identityHex: "p2",
      rootX: right,
      slashProgress: 0.5,
      slashAngle: Math.PI,
      bladeTip: { x: 0.1, y: 1, z: 0 },
      bladeBase: { x: 0.3, y: 1, z: 0 },
    }),
  });
  assert.equal(clash, null);
});

test("outside hit window does not connect", () => {
  const { player, dummy } = leftAttackingRight({
    player: { slashProgress: HIT_WINDOW_START - 0.05 },
  });
  assert.equal(resolveCombat({ player, dummy }), null);
});

test("lunge brings tip into reach for a hit", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const lungedRoot = left + 0.6;
  // Tip must enter the body capsule (no seat-proximity fallback).
  const tipX = right - 0.15;
  const result = resolveCombat({
    player: fighter({
      identityHex: "p1",
      rootX: lungedRoot,
      slashProgress: 0.5,
      slashAngle: 0,
      bladeTip: { x: tipX, y: 1, z: 0 },
      bladeBase: { x: tipX - 0.4, y: 1, z: 0.1 },
    }),
    dummy: fighter({
      identityHex: "p2",
      rootX: right,
    }),
  });
  assert.ok(result);
  assert.equal(result.kind, "hit");
});

test("physical tip-in-capsule connects; seat-lag tip short of capsule misses", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;

  const physical = resolveCombat({
    player: fighter({
      identityHex: "p1",
      rootX: left,
      slashProgress: 0.5,
      slashAngle: 0,
      bladeTip: { x: right, y: 1.1, z: 0 },
      bladeBase: { x: right - 0.4, y: 1.0, z: 0.1 },
    }),
    dummy: fighter({
      identityHex: "p2",
      rootX: right,
    }),
  });
  assert.ok(physical);
  assert.equal(physical!.kind, "hit");

  // Seats already in strike gap, but tip is far short of the capsule — no fallback.
  const playerRoot = right - STRIKE_GAP_M;
  const lag = resolveCombat({
    player: fighter({
      identityHex: "p1",
      rootX: playerRoot,
      slashProgress: 0.5,
      slashAngle: 0,
      // Tip behind the attacker so distance to defender capsule exceeds padding.
      bladeTip: { x: playerRoot - 0.2, y: 1.2, z: 0.1 },
      bladeBase: { x: playerRoot - 0.4, y: 1.0, z: 0.1 },
    }),
    dummy: fighter({
      identityHex: "p2",
      rootX: right,
    }),
  });
  assert.equal(lag, null);
});

test("short invuln rejects then accepts once cleared", () => {
  const { player, dummy } = leftAttackingRight({ dummy: { invulnerable: true } });
  assert.equal(resolveCombat({ player, dummy }), null);

  dummy.invulnerable = false;
  const after = resolveCombat({ player, dummy });
  assert.ok(after);
  assert.equal(after!.kind, "hit");
});

test("hit then regroup then second lunge still resolves", () => {
  const left = -PREFERRED_SPACING / 2;
  const right = PREFERRED_SPACING / 2;
  const lunged = lungeTargetX(left, right, 1);
  const first = resolveCombat({
    player: fighter({
      identityHex: "p1",
      rootX: lunged,
      slashProgress: 0.5,
      slashAngle: 0,
      bladeTip: { x: lunged + 0.55, y: 1.15, z: 0.2 },
      bladeBase: { x: lunged + 0.08, y: 1.0, z: 0.12 },
    }),
    dummy: fighter({ identityHex: "p2", rootX: right }),
  });
  assert.ok(first);
  assert.equal(first!.kind, "hit");

  const reseat = regroupTargets(
    { playerX: first!.playerRootX, dummyX: first!.dummyRootX },
    true,
  );
  near(Math.abs(reseat.dummyX - reseat.playerX), PREFERRED_SPACING);

  const secondOrigin = reseat.playerX;
  const secondLunged = lungeTargetX(secondOrigin, reseat.dummyX, 1);
  const tip = { x: secondLunged + 0.55, y: 1.15, z: 0.2 };
  const base = { x: secondLunged + 0.08, y: 1.0, z: 0.12 };
  assert.equal(bladeHitsBody(base, tip, reseat.dummyX), true);

  const second = resolveCombat({
    player: fighter({
      identityHex: "p1",
      rootX: secondLunged,
      slashProgress: 0.5,
      slashAngle: 0,
      bladeTip: tip,
      bladeBase: base,
    }),
    dummy: fighter({ identityHex: "p2", rootX: reseat.dummyX }),
  });
  assert.ok(second);
  assert.equal(second!.kind, "hit");
});
