import {
  COUNTDOWN_BEAT_SECONDS,
  INTRO_OUTSIDE_HALF,
  ROUNDS_TO_WIN,
  SEAT_HALF_SPACING,
  WALK_IN_SECONDS,
  type MatchPhase,
} from "./CombatConstants.ts";

export type CountdownLabel = "3" | "2" | "1" | "FIGHT" | null;

export type MatchPhaseHud = {
  phase: MatchPhase;
  countdownLabel: CountdownLabel;
  roundIndex: number;
  p1Wins: number;
  p2Wins: number;
  matchWinner: "p1" | "p2" | null;
  combatOpen: boolean;
};

export type MatchPhaseSnapshot = MatchPhaseHud & {
  playerX: number;
  dummyX: number;
};

const COUNTDOWN_LABELS: CountdownLabel[] = ["3", "2", "1", "FIGHT"];

/**
 * Local match / solo phase driver: Intro → Countdown → WalkIn → Fighting.
 * Combat resolves only while `combatOpen` (Fighting).
 */
export class MatchPhaseMachine {
  phase: MatchPhase = "Idle";
  countdownLabel: CountdownLabel = null;
  roundIndex = 1;
  p1Wins = 0;
  p2Wins = 0;
  matchWinner: "p1" | "p2" | null = null;

  private phaseElapsed = 0;
  private countdownBeat = 0;
  private walkFromPlayerX = -INTRO_OUTSIDE_HALF;
  private walkFromDummyX = INTRO_OUTSIDE_HALF;

  get combatOpen(): boolean {
    return this.phase === "Fighting";
  }

  hud(): MatchPhaseHud {
    return {
      phase: this.phase,
      countdownLabel: this.countdownLabel,
      roundIndex: this.roundIndex,
      p1Wins: this.p1Wins,
      p2Wins: this.p2Wins,
      matchWinner: this.matchWinner,
      combatOpen: this.combatOpen,
    };
  }

  /** Begin a fresh match (or solo duel) from outside seats. */
  startMatch(): MatchPhaseSnapshot {
    this.p1Wins = 0;
    this.p2Wins = 0;
    this.matchWinner = null;
    this.roundIndex = 1;
    return this.beginRoundIntro();
  }

  /** After a round ring-out, if match continues. */
  startNextRound(): MatchPhaseSnapshot | null {
    if (this.matchWinner) return null;
    this.roundIndex += 1;
    return this.beginRoundIntro();
  }

  resetIdle(): MatchPhaseSnapshot {
    this.phase = "Idle";
    this.countdownLabel = null;
    this.phaseElapsed = 0;
    this.countdownBeat = 0;
    this.roundIndex = 1;
    this.p1Wins = 0;
    this.p2Wins = 0;
    this.matchWinner = null;
    return {
      ...this.hud(),
      playerX: -SEAT_HALF_SPACING,
      dummyX: SEAT_HALF_SPACING,
    };
  }

  /**
   * Advance timers. Returns seat targets when they should be applied
   * (Intro seats, WalkIn lerp, or Fighting lock).
   */
  tick(dt: number): MatchPhaseSnapshot | null {
    if (this.phase === "Idle" || this.phase === "RoundEnd" || this.phase === "MatchEnd") {
      return null;
    }

    this.phaseElapsed += dt;

    if (this.phase === "Intro") {
      // Brief hold outside before countdown digits.
      if (this.phaseElapsed >= 0.35) {
        this.enterCountdown();
      }
      return {
        ...this.hud(),
        playerX: -INTRO_OUTSIDE_HALF,
        dummyX: INTRO_OUTSIDE_HALF,
      };
    }

    if (this.phase === "Countdown") {
      // Epsilon avoids float drift (e.g. 0.7*3 → 2.0999…) stalling on "1".
      const beat = Math.floor((this.phaseElapsed + 1e-9) / COUNTDOWN_BEAT_SECONDS);
      if (beat !== this.countdownBeat && beat < COUNTDOWN_LABELS.length) {
        this.countdownBeat = beat;
        this.countdownLabel = COUNTDOWN_LABELS[beat] ?? null;
      }
      if (this.phaseElapsed + 1e-9 >= COUNTDOWN_BEAT_SECONDS * COUNTDOWN_LABELS.length) {
        this.enterWalkIn();
      }
      return {
        ...this.hud(),
        playerX: -INTRO_OUTSIDE_HALF,
        dummyX: INTRO_OUTSIDE_HALF,
      };
    }

    if (this.phase === "WalkIn") {
      const t = Math.min(1, this.phaseElapsed / WALK_IN_SECONDS);
      const ease = t * t * (3 - 2 * t);
      const playerX =
        this.walkFromPlayerX + (-SEAT_HALF_SPACING - this.walkFromPlayerX) * ease;
      const dummyX =
        this.walkFromDummyX + (SEAT_HALF_SPACING - this.walkFromDummyX) * ease;
      if (t >= 1) {
        this.phase = "Fighting";
        this.countdownLabel = null;
        this.phaseElapsed = 0;
        return {
          ...this.hud(),
          playerX: -SEAT_HALF_SPACING,
          dummyX: SEAT_HALF_SPACING,
        };
      }
      return { ...this.hud(), playerX, dummyX };
    }

    return null;
  }

  /** Record a soft-edge ring-out for seat P1 (host) or P2 (guest). */
  onRingOut(winner: "p1" | "p2"): {
    matchOver: boolean;
    snapshot: MatchPhaseSnapshot;
  } {
    if (winner === "p1") this.p1Wins += 1;
    else this.p2Wins += 1;

    if (this.p1Wins >= ROUNDS_TO_WIN) {
      this.matchWinner = "p1";
      this.phase = "MatchEnd";
      this.countdownLabel = null;
      return {
        matchOver: true,
        snapshot: {
          ...this.hud(),
          playerX: -SEAT_HALF_SPACING,
          dummyX: SEAT_HALF_SPACING,
        },
      };
    }
    if (this.p2Wins >= ROUNDS_TO_WIN) {
      this.matchWinner = "p2";
      this.phase = "MatchEnd";
      this.countdownLabel = null;
      return {
        matchOver: true,
        snapshot: {
          ...this.hud(),
          playerX: -SEAT_HALF_SPACING,
          dummyX: SEAT_HALF_SPACING,
        },
      };
    }

    this.phase = "RoundEnd";
    this.countdownLabel = null;
    return {
      matchOver: false,
      snapshot: {
        ...this.hud(),
        playerX: -SEAT_HALF_SPACING,
        dummyX: SEAT_HALF_SPACING,
      },
    };
  }

  private beginRoundIntro(): MatchPhaseSnapshot {
    this.phase = "Intro";
    this.countdownLabel = null;
    this.phaseElapsed = 0;
    this.countdownBeat = 0;
    this.walkFromPlayerX = -INTRO_OUTSIDE_HALF;
    this.walkFromDummyX = INTRO_OUTSIDE_HALF;
    return {
      ...this.hud(),
      playerX: -INTRO_OUTSIDE_HALF,
      dummyX: INTRO_OUTSIDE_HALF,
    };
  }

  private enterCountdown(): void {
    this.phase = "Countdown";
    this.phaseElapsed = 0;
    this.countdownBeat = 0;
    this.countdownLabel = "3";
  }

  private enterWalkIn(): void {
    this.phase = "WalkIn";
    this.phaseElapsed = 0;
    this.countdownLabel = "FIGHT";
    this.walkFromPlayerX = -INTRO_OUTSIDE_HALF;
    this.walkFromDummyX = INTRO_OUTSIDE_HALF;
  }
}
