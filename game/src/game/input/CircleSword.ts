export type CirclePoint = { x: number; y: number };
export type CircleDirectionWeights = { forward: number; lateral: number; vertical: number };
export type GuardPoseOffsets = { lateral: number; vertical: number; forward: number };
export type SwordPhase = "aiming" | "slashing" | "recovering";
export const CUT_SECONDS = 0.22;
const HOLD_SECONDS = 0.10;
const RECOVER_SECONDS = 0.28;
const AIM_DEAD_ZONE = 0.08;
export const AIM_INPUT_SCALE = 1.4;
export const MIN_SWING_RADIUS = 0.40;
const LOWER_VERTICAL_SCALE = 0.7;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** World-space meter offsets applied to the neutral two-hand grip. */
export function guardPoseOffsets(point: CirclePoint): GuardPoseOffsets {
  const upperAmount = Math.max(0, Math.min(1, point.y));
  const lowerAmount = Math.max(-1, Math.min(0, point.y));
  return {
    lateral: Math.max(-1, Math.min(1, point.x)) * 0.16,
    // At the top of the circle the grip is centered above the head, matching
    // the reference rig's reachable overhead posture.
    vertical: upperAmount * 0.62 + lowerAmount * 0.14,
    forward: upperAmount * 0.08,
  };
}

function clampUnitDisk(x: number, y: number): CirclePoint {
  const length = Math.hypot(x, y);
  if (length <= 1) return { x, y };
  return { x: x / length, y: y / length };
}

/**
 * Adaptive low-pass filter: smooths heavily when the signal is nearly still
 * (hides jitter) and lightly when it moves fast (keeps it responsive).
 */
class OneEuro {
  private prev: number | null = null;
  private dPrev = 0;
  private t = 0;
  minCutoff: number;
  beta: number;
  dCutoff: number;

  constructor(minCutoff = 1.5, beta = 1.0, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.prev = null;
    this.dPrev = 0;
  }

  filter(v: number, nowMs: number): number {
    if (this.prev === null) {
      this.prev = v;
      this.t = nowMs;
      return v;
    }
    const dt = Math.max((nowMs - this.t) / 1000, 1e-3);
    this.t = nowMs;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
    this.dPrev += ((v - this.prev) / dt - this.dPrev) * alpha(this.dCutoff);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dPrev);
    this.prev += (v - this.prev) * alpha(cutoff);
    return this.prev;
  }
}

/** Guard selection fills the disk; committed cuts pass through its center. */
export class CircleSword {
  phase: SwordPhase = "aiming";
  point: CirclePoint = { x: 0, y: 0 };
  private aimAngle = Math.PI / 2;
  private aimRadius = 0;
  private start: CirclePoint = { x: 0, y: 0 };
  private end: CirclePoint = { x: 0, y: 0 };
  private elapsed = 0;
  private fx = new OneEuro();
  private fy = new OneEuro();

  aim(x: number, y: number, now: number = performance.now()): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // A smaller physical tilt range fills the gameplay disk, making guard
    // placement and the outer swing zone easier to reach one-handed.
    const input = clampUnitDisk(
      this.fx.filter(x, now) * AIM_INPUT_SCALE,
      this.fy.filter(y, now) * AIM_INPUT_SCALE,
    );
    const rawRadius = Math.hypot(input.x, input.y);
    if (rawRadius <= AIM_DEAD_ZONE) {
      this.aimRadius = 0;
    } else {
      const normalizedRadius = Math.min(1, (rawRadius - AIM_DEAD_ZONE) / (1 - AIM_DEAD_ZONE));
      this.aimRadius = Math.pow(normalizedRadius, 1.5);
    }
    // Keep the last direction at center, where an angle is undefined.
    if (rawRadius > AIM_DEAD_ZONE) this.aimAngle = Math.atan2(input.y, input.x);
  }

  /** Slash start angle on the aim circle (radians), or null if not cutting. */
  get slashAngle(): number | null {
    if (this.phase === "aiming") return null;
    return Math.atan2(this.start.y, this.start.x);
  }

  /** 0–1 through the cut while slashing; null otherwise. */
  get slashProgress(): number | null {
    if (this.phase !== "slashing") return null;
    return Math.min(1, Math.max(0, this.elapsed / CUT_SECONDS));
  }

  slash(): boolean {
    if (this.phase !== "aiming") return false;
    const start = { ...this.point };
    const startRadius = Math.hypot(start.x, start.y);
    // Acceleration events inside the outer swing zone are consumed by the
    // host but do not begin (or queue) a cut.
    if (startRadius < MIN_SWING_RADIUS) return false;
    this.start = start;
    const direction = Math.atan2(this.start.y, this.start.x);
    this.end = {
      x: -Math.cos(direction) * startRadius,
      y: -Math.sin(direction) * startRadius,
    };
    this.elapsed = 0;
    this.phase = "slashing";
    return true;
  }

  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.phase === "aiming") {
      // Smooth in Cartesian space so the point travels straight through the
      // center instead of orbiting the rim.
      const alpha = 1 - Math.exp(-25 * dt);
      const target = {
        x: Math.cos(this.aimAngle) * this.aimRadius,
        y: Math.sin(this.aimAngle) * this.aimRadius,
      };
      this.point = {
        x: this.point.x + (target.x - this.point.x) * alpha,
        y: this.point.y + (target.y - this.point.y) * alpha,
      };
      return;
    }
    this.elapsed += dt;
    if (this.elapsed <= CUT_SECONDS) {
      const progress = this.elapsed / CUT_SECONDS;
      if (progress <= 0.5) {
        const scale = 1 - smooth(progress * 2);
        this.point = { x: this.start.x * scale, y: this.start.y * scale };
      } else {
        const scale = smooth((progress - 0.5) * 2);
        this.point = { x: this.end.x * scale, y: this.end.y * scale };
      }
      return;
    }
    this.phase = "recovering";
    const t = Math.min(1, Math.max(0, (this.elapsed - CUT_SECONDS - HOLD_SECONDS) / RECOVER_SECONDS));
    const blend = smooth(t);
    const aim = {
      x: Math.cos(this.aimAngle) * this.aimRadius,
      y: Math.sin(this.aimAngle) * this.aimRadius,
    };
    this.point = {
      x: this.end.x * (1 - blend) + aim.x * blend,
      y: this.end.y * (1 - blend) + aim.y * blend,
    };
    if (t === 1) {
      this.phase = "aiming";
    }
  }
}

/** Require a quiet interval before rearming, plus a full animation cooldown. */
export class SwingDetector {
  threshold = 12;
  private quietSince: number | null = null;
  private armed = false;
  private lastSwing = -Infinity;

  reset(): void {
    this.quietSince = null;
    this.armed = false;
    this.lastSwing = -Infinity;
  }

  sample(magnitude: number, now: number): boolean {
    if (!Number.isFinite(magnitude) || !Number.isFinite(now)) return false;
    if (magnitude < this.threshold * 0.4) {
      this.quietSince ??= now;
      if (now - this.quietSince >= 120) this.armed = true;
    } else {
      this.quietSince = null;
    }
    if (magnitude >= this.threshold && this.armed) {
      this.armed = false;
      if (now - this.lastSwing < 650) return false;
      this.lastSwing = now;
      return true;
    }
    return false;
  }
}

/**
 * Projects the circular control disk onto the fighter's forward hemisphere.
 * The upper rim reaches vertical, while the lower rim retains some forward
 * direction so the sword cannot be held vertically downward.
 */
export function circleDirectionWeights(point: CirclePoint): CircleDirectionWeights {
  const clamped = clampUnitDisk(point.x, point.y);
  const vertical = clamped.y < 0 ? clamped.y * LOWER_VERTICAL_SCALE : clamped.y;
  return {
    forward: Math.sqrt(Math.max(0, 1 - clamped.x * clamped.x - vertical * vertical)),
    lateral: clamped.x,
    vertical,
  };
}
