/**
 * Phone slashCount → host arming policy.
 * Pure so consecutive-swing bugs can be unit-tested without Babylon.
 */

export interface SlashArmingInput {
  slashCount: number;
  lastSlashCount: number;
  blocking: boolean;
  stunned: boolean;
  /** Result of CircleSword.slash() for this sample. */
  slashAccepted: boolean;
}

export interface SlashArmingResult {
  lastSlashCount: number;
  /** True when a new cut should begin (lunge + localSlashSeq++). */
  armed: boolean;
}

/**
 * Advance lastSlashCount for one controller sample.
 *
 * - Blocking/stun: consume the full count (swings ignored).
 * - slash() accepted: consume exactly one so queued counts during recover
 *   can still arm follow-up cuts.
 * - slash() rejected (phase / aim radius): leave lastSlashCount unchanged
 *   so the next live sample can retry.
 */
export function advanceSlashArming(input: SlashArmingInput): SlashArmingResult {
  const { slashCount, lastSlashCount, blocking, stunned, slashAccepted } = input;
  if (slashCount <= lastSlashCount) {
    return { lastSlashCount, armed: false };
  }
  if (blocking || stunned) {
    return { lastSlashCount: slashCount, armed: false };
  }
  if (slashAccepted) {
    return { lastSlashCount: lastSlashCount + 1, armed: true };
  }
  return { lastSlashCount, armed: false };
}
