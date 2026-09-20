import assert from "node:assert/strict";
import { test } from "node:test";

import { ADVANCE_M, ARENA_RADIUS, KNOCKBACK_M, PREFERRED_SPACING } from "./CombatConstants.ts";
import {
  mapHostSeatsToLocalView,
  mapHostSoftEdgeToLocalView,
  publisherAuthoredRootX,
} from "./CombatSeatMap.ts";
import { regroupTargets } from "./CombatFootwork.ts";
import { resolveCombat, type FighterSnapshot } from "./CombatResolver.ts";

function near(actual: number, expected: number, eps = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);
}

const HALF = PREFERRED_SPACING / 2;

function baseFighter(partial: Partial<FighterSnapshot> & Pick<FighterSnapshot, "identityHex" | "rootX">): FighterSnapshot {
  return {
    blocking: false,
    blockingBeforeWindow: false,
    slashProgress: null,
    slashAngle: null,
    guardX: 0,
    guardY: 1,
    bladeTip: { x: partial.rootX, y: 1.2, z: 0.4 },
    bladeBase: { x: partial.rootX, y: 1.0, z: 0.1 },
    onSoftEdge: false,
    invulnerable: false,
    ...partial,
  };
}

test("host path is identity", () => {
  const host = { playerX: -1.02, dummyX: 1.58 };
  assert.deepEqual(mapHostSeatsToLocalView(true, host), host);
});

test("guest mirrors host seats onto local-left / remote-right", () => {
  const host = { playerX: -1.02, dummyX: 1.58 };
  const guest = mapHostSeatsToLocalView(false, host);
  near(guest.playerX, -1.58);
  near(guest.dummyX, 1.02);
});

test("guest soft-edge flags follow fighter identity across the mirror", () => {
  const mapped = mapHostSoftEdgeToLocalView(false, {
    playerOnSoftEdge: false,
    dummyOnSoftEdge: true,
  });
  assert.equal(mapped.playerOnSoftEdge, true);
  assert.equal(mapped.dummyOnSoftEdge, false);
});

test("hit: host seats match resolver; guest sees defender outbound + attacker advance", () => {
  const left = -HALF;
  const right = HALF;
  const player = baseFighter({
    identityHex: "host",
    rootX: left,
    slashProgress: 0.45,
    slashAngle: 0,
    bladeTip: { x: right - 0.15, y: 1.1, z: 0 },
    bladeBase: { x: left + 0.3, y: 1.0, z: 0 },
  });
  const dummy = baseFighter({
    identityHex: "guest",
    rootX: right,
  });
  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "hit");

  // Host fixtures unchanged from resolver expectations.
  near(result.playerRootX, left + ADVANCE_M);
  near(result.dummyRootX, right + KNOCKBACK_M);

  const hostView = mapHostSeatsToLocalView(true, {
    playerX: result.playerRootX,
    dummyX: result.dummyRootX,
  });
  near(hostView.playerX, left + ADVANCE_M);
  near(hostView.dummyX, right + KNOCKBACK_M);
  // Host (attacker) advances toward foe; dummy (defender) outbound.
  assert.ok(hostView.playerX > left);
  assert.ok(hostView.dummyX > right);

  const guestView = mapHostSeatsToLocalView(false, {
    playerX: result.playerRootX,
    dummyX: result.dummyRootX,
  });
  // Guest is defender: local moves outbound (more negative).
  near(guestView.playerX, -(right + KNOCKBACK_M));
  near(guestView.dummyX, -(left + ADVANCE_M));
  assert.ok(guestView.playerX < -right);
  // Attacker (remote) advances toward local (dummyX decreases toward local).
  assert.ok(guestView.dummyX < right);
  assert.ok(guestView.dummyX > guestView.playerX);
});

test("guest hits host: guest local advances; host remote outbound on guest screen", () => {
  const left = -HALF;
  const right = HALF;
  const player = baseFighter({ identityHex: "host", rootX: left });
  const dummy = baseFighter({
    identityHex: "guest",
    rootX: right,
    slashProgress: 0.45,
    slashAngle: 0,
    bladeTip: { x: left + 0.15, y: 1.1, z: 0 },
    bladeBase: { x: right - 0.3, y: 1.0, z: 0 },
  });
  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "hit");
  near(result.playerRootX, left - KNOCKBACK_M);
  near(result.dummyRootX, right - ADVANCE_M);

  const guestView = mapHostSeatsToLocalView(false, {
    playerX: result.playerRootX,
    dummyX: result.dummyRootX,
  });
  // Local (guest attacker) advances toward foe (less negative / toward center).
  near(guestView.playerX, -(right - ADVANCE_M));
  near(guestView.dummyX, -(left - KNOCKBACK_M));
  assert.ok(guestView.playerX > -right);
  assert.ok(guestView.dummyX > right);
});

test("blocked: guest mirror keeps blocker still and attacker outbound on their screen", () => {
  const left = -HALF;
  const right = HALF;
  const guardAngle = (35 * 0.5 * Math.PI) / 180;
  const player = baseFighter({
    identityHex: "host",
    rootX: left,
    slashProgress: 0.45,
    slashAngle: 0,
    bladeTip: { x: right - 0.15, y: 1.1, z: 0 },
    bladeBase: { x: left + 0.3, y: 1.0, z: 0 },
  });
  const dummy = baseFighter({
    identityHex: "guest",
    rootX: right,
    blocking: true,
    blockingBeforeWindow: true,
    guardX: Math.cos(guardAngle),
    guardY: Math.sin(guardAngle),
  });
  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "blocked");
  near(result.dummyRootX, right);
  near(result.playerRootX, left - KNOCKBACK_M);

  const guestView = mapHostSeatsToLocalView(false, {
    playerX: result.playerRootX,
    dummyX: result.dummyRootX,
  });
  near(guestView.playerX, -right);
  near(guestView.dummyX, -(left - KNOCKBACK_M));
  // Blocker (local) unmoved; attacker (remote) pushed outbound away from local.
  assert.ok(guestView.dummyX > right);
});

test("clash: both outbound on each screen after mirror", () => {
  const left = -HALF;
  const right = HALF;
  const mid = 0;
  const player = baseFighter({
    identityHex: "host",
    rootX: left,
    slashProgress: 0.45,
    slashAngle: 0,
    bladeTip: { x: mid, y: 1, z: 0 },
    bladeBase: { x: mid - 0.2, y: 1, z: 0 },
  });
  const dummy = baseFighter({
    identityHex: "guest",
    rootX: right,
    slashProgress: 0.55,
    slashAngle: Math.PI,
    bladeTip: { x: mid + 0.14, y: 1, z: 0 },
    bladeBase: { x: mid + 0.34, y: 1, z: 0 },
  });
  const result = resolveCombat({ player, dummy });
  assert.ok(result);
  assert.equal(result.kind, "clash");

  const guestView = mapHostSeatsToLocalView(false, {
    playerX: result.playerRootX,
    dummyX: result.dummyRootX,
  });
  assert.ok(guestView.playerX < -HALF + 1e-6);
  assert.ok(guestView.dummyX > HALF - 1e-6);
});

test("ring-edge soft flags map with seats; abs radius preserved", () => {
  const hostPlayer = -(ARENA_RADIUS - 0.01);
  const hostDummy = ARENA_RADIUS - 0.01;
  const guest = mapHostSeatsToLocalView(false, {
    playerX: hostPlayer,
    dummyX: hostDummy,
  });
  near(Math.abs(guest.playerX), ARENA_RADIUS - 0.01);
  near(Math.abs(guest.dummyX), ARENA_RADIUS - 0.01);
  const flags = mapHostSoftEdgeToLocalView(false, {
    playerOnSoftEdge: true,
    dummyOnSoftEdge: false,
  });
  assert.equal(flags.playerOnSoftEdge, false);
  assert.equal(flags.dummyOnSoftEdge, true);
});

test("guest regroup after hit keeps defender outbound X", () => {
  const afterHit = { playerX: -HALF + ADVANCE_M, dummyX: HALF + KNOCKBACK_M };
  const guestSeats = mapHostSeatsToLocalView(false, afterHit);
  // Guest was defender → attackerIsPlayer false on their screen.
  const targets = regroupTargets(guestSeats, false);
  near(targets.playerX, guestSeats.playerX);
  assert.ok(Math.abs(targets.dummyX - targets.playerX) >= PREFERRED_SPACING - 1e-6);
});

test("publisher authored root equals -dummyX (symmetric identity)", () => {
  near(publisherAuthoredRootX(HALF), -HALF);
  near(publisherAuthoredRootX(HALF + KNOCKBACK_M), -(HALF + KNOCKBACK_M));
});
