/**
 * Duel-axis blade pose for host/solo combat resolve.
 * Visual WeaponTarget tips can point off-axis mid-cut; hit math needs a tip
 * that extends toward the opponent once seats are lunged.
 */

import { lungeFactorFromSlashProgress } from "./CombatFootwork.ts";

export interface CombatBladePose {
  tip: { x: number; y: number; z: number };
  base: { x: number; y: number; z: number };
  tipReach: number;
}

/**
 * Tip extends toward the opponent along the duel axis while slashing.
 * Reach is tuned so a full lunge at preferred spacing still connects even when
 * the rendered shinai tip lags or aims off-axis.
 */
export function estimateCombatBladePose(args: {
  rootX: number;
  opponentX: number;
  slashProgress: number | null;
  guardX: number;
  guardY: number;
}): CombatBladePose {
  const { rootX, opponentX, slashProgress, guardX, guardY } = args;
  const toward = Math.sign(opponentX - rootX) || -1;
  const factor = lungeFactorFromSlashProgress(slashProgress);
  // Mid-cut tip ~0.8 m toward opponent — connects after full lunge, misses at idle 2.2 m.
  const tipReach =
    slashProgress !== null ? 0.3 + 0.5 * Math.max(factor, 0.4) : 0.2;
  return {
    tipReach,
    base: {
      x: rootX + toward * 0.1,
      y: 1.05 + guardY * 0.05,
      z: 0.05,
    },
    tip: {
      x: rootX + toward * tipReach - toward * guardX * 0.1,
      y: 1.1 + guardY * 0.25,
      z: 0.08,
    },
  };
}

/**
 * Prefer whichever tip reaches farther toward the opponent: the duel-axis
 * combat estimate, or the live WeaponTarget tip when it is already on-axis.
 */
export function pickAttackerBladePose(args: {
  rootX: number;
  opponentX: number;
  slashProgress: number | null;
  guardX: number;
  guardY: number;
  physicalTip?: { x: number; y: number; z: number } | null;
  physicalBase?: { x: number; y: number; z: number } | null;
}): CombatBladePose {
  const estimated = estimateCombatBladePose(args);
  const physicalTip = args.physicalTip;
  const physicalBase = args.physicalBase;
  if (!physicalTip || !physicalBase) return estimated;
  if (![physicalTip.x, physicalTip.y, physicalTip.z, physicalBase.x, physicalBase.y, physicalBase.z]
    .every(Number.isFinite)) {
    return estimated;
  }
  const toward = Math.sign(args.opponentX - args.rootX) || 1;
  const physicalReach = (physicalTip.x - args.rootX) * toward;
  const estimatedReach = (estimated.tip.x - args.rootX) * toward;
  if (physicalReach >= estimatedReach) {
    return {
      tipReach: physicalReach,
      tip: physicalTip,
      base: physicalBase,
    };
  }
  return estimated;
}

/** @deprecated Prefer estimateCombatBladePose — same math for remote seat. */
export const estimateRemoteBladePose = estimateCombatBladePose;
