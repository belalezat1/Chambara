import assert from "node:assert/strict";
import test from "node:test";

import { advanceSlashArming } from "./CombatSlashArming.ts";

test("failed slash arm does not advance lastSlashCount", () => {
  const result = advanceSlashArming({
    slashCount: 3,
    lastSlashCount: 2,
    blocking: false,
    stunned: false,
    slashAccepted: false,
  });
  assert.equal(result.armed, false);
  assert.equal(result.lastSlashCount, 2);
});

test("accepted slash consumes exactly one count", () => {
  const result = advanceSlashArming({
    slashCount: 5,
    lastSlashCount: 2,
    blocking: false,
    stunned: false,
    slashAccepted: true,
  });
  assert.equal(result.armed, true);
  assert.equal(result.lastSlashCount, 3);
});

test("queued counts after recover can arm a second cut", () => {
  // Phone jumped 2→4 while recovering; first accept only consumes one.
  let last = 2;
  const first = advanceSlashArming({
    slashCount: 4,
    lastSlashCount: last,
    blocking: false,
    stunned: false,
    slashAccepted: true,
  });
  assert.equal(first.armed, true);
  last = first.lastSlashCount;
  assert.equal(last, 3);

  // Still behind phone count — second accept once CircleSword is aiming again.
  const second = advanceSlashArming({
    slashCount: 4,
    lastSlashCount: last,
    blocking: false,
    stunned: false,
    slashAccepted: true,
  });
  assert.equal(second.armed, true);
  assert.equal(second.lastSlashCount, 4);
});

test("blocking consumes the full slashCount bump", () => {
  const result = advanceSlashArming({
    slashCount: 7,
    lastSlashCount: 4,
    blocking: true,
    stunned: false,
    slashAccepted: false,
  });
  assert.equal(result.armed, false);
  assert.equal(result.lastSlashCount, 7);
});

test("stun consumes the full slashCount bump", () => {
  const result = advanceSlashArming({
    slashCount: 7,
    lastSlashCount: 4,
    blocking: false,
    stunned: true,
    slashAccepted: true,
  });
  assert.equal(result.armed, false);
  assert.equal(result.lastSlashCount, 7);
});

test("no bump leaves arming unchanged", () => {
  const result = advanceSlashArming({
    slashCount: 2,
    lastSlashCount: 2,
    blocking: false,
    stunned: false,
    slashAccepted: true,
  });
  assert.equal(result.armed, false);
  assert.equal(result.lastSlashCount, 2);
});
