import assert from "node:assert/strict";
import { test } from "node:test";

import {
  COUNTDOWN_BEAT_SECONDS,
  INTRO_OUTSIDE_HALF,
  PREFERRED_SPACING,
  ROUNDS_TO_WIN,
  SEAT_HALF_SPACING,
  WALK_IN_SECONDS,
} from "./CombatConstants.ts";
import { MatchPhaseMachine } from "./MatchPhaseMachine.ts";

test("PREFERRED_SPACING is 2.6", () => {
  assert.equal(PREFERRED_SPACING, 2.6);
  assert.equal(SEAT_HALF_SPACING, 1.3);
});

test("startMatch places fighters outside then opens combat after countdown+walk", () => {
  const m = new MatchPhaseMachine();
  const intro = m.startMatch();
  assert.equal(intro.phase, "Intro");
  assert.equal(intro.combatOpen, false);
  assert.equal(intro.playerX, -INTRO_OUTSIDE_HALF);
  assert.equal(intro.dummyX, INTRO_OUTSIDE_HALF);

  m.tick(0.4);
  assert.equal(m.phase, "Countdown");
  assert.equal(m.countdownLabel, "3");

  m.tick(COUNTDOWN_BEAT_SECONDS);
  assert.equal(m.countdownLabel, "2");
  m.tick(COUNTDOWN_BEAT_SECONDS);
  assert.equal(m.countdownLabel, "1");
  m.tick(COUNTDOWN_BEAT_SECONDS);
  assert.equal(m.countdownLabel, "FIGHT");

  const walk = m.tick(COUNTDOWN_BEAT_SECONDS);
  assert.ok(walk);
  assert.equal(walk.phase, "WalkIn");

  const fighting = m.tick(WALK_IN_SECONDS);
  assert.ok(fighting);
  assert.equal(fighting.phase, "Fighting");
  assert.equal(fighting.combatOpen, true);
  assert.equal(fighting.playerX, -SEAT_HALF_SPACING);
  assert.equal(fighting.dummyX, SEAT_HALF_SPACING);
});

test("best of 3: first to ROUNDS_TO_WIN ends match", () => {
  const m = new MatchPhaseMachine();
  m.startMatch();
  // Skip to fighting
  m.tick(0.4);
  m.tick(COUNTDOWN_BEAT_SECONDS * 4);
  m.tick(WALK_IN_SECONDS);

  const r1 = m.onRingOut("p1");
  assert.equal(r1.matchOver, false);
  assert.equal(m.p1Wins, 1);
  assert.equal(m.phase, "RoundEnd");

  m.startNextRound();
  m.tick(0.4);
  m.tick(COUNTDOWN_BEAT_SECONDS * 4);
  m.tick(WALK_IN_SECONDS);

  const r2 = m.onRingOut("p1");
  assert.equal(r2.matchOver, true);
  assert.equal(m.matchWinner, "p1");
  assert.equal(m.phase, "MatchEnd");
  assert.equal(ROUNDS_TO_WIN, 2);
});

test("guest applyAuthoritative locks countdown to host without local tick", () => {
  const host = new MatchPhaseMachine();
  host.startMatch();
  host.tick(0.4);
  host.tick(COUNTDOWN_BEAT_SECONDS);
  assert.equal(host.countdownLabel, "2");

  const guest = new MatchPhaseMachine();
  guest.parkForRemoteSync();
  assert.equal(guest.phase, "Intro");
  assert.equal(guest.countdownLabel, null);

  const applied = guest.applyAuthoritative({
    phase: host.phase,
    countdownLabel: host.countdownLabel,
    roundIndex: host.roundIndex,
    p1Wins: host.p1Wins,
    p2Wins: host.p2Wins,
    matchWinner: host.matchWinner,
    playerX: -INTRO_OUTSIDE_HALF,
    dummyX: INTRO_OUTSIDE_HALF,
  });
  assert.equal(applied.phase, "Countdown");
  assert.equal(applied.countdownLabel, "2");
  assert.equal(guest.combatOpen, false);

  guest.applyAuthoritative({
    phase: "Fighting",
    countdownLabel: null,
    roundIndex: 1,
    p1Wins: 0,
    p2Wins: 0,
    matchWinner: null,
    playerX: -SEAT_HALF_SPACING,
    dummyX: SEAT_HALF_SPACING,
  });
  assert.equal(guest.phase, "Fighting");
  assert.equal(guest.combatOpen, true);
});
