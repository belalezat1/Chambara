import {
  ADVANCE_M,
  ARENA_RADIUS,
  BLOCK_ANGLE_DEG,
  CLASH_BLADE_DIST,
  HIT_WINDOW_END,
  HIT_WINDOW_START,
  KNOCKBACK_M,
  type CombatOutcomeKind,
} from "./CombatConstants.ts";
import { bladeHitsBody } from "./CombatCollision.ts";

export type { CombatOutcomeKind };

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Per-fighter snapshot for one host combat tick.
 * Host supplies intents, slash progress, blade poses, and soft-edge / i-frame flags.
 */
export interface FighterSnapshot {
  identityHex: string;
  blocking: boolean;
  /**
   * True if `blocking` was already held when the opponent's slash first entered
   * the hit window (host latches this per exchange).
   */
  blockingBeforeWindow: boolean;
  /** Cut progress in [0, 1] while slashing; null when not cutting. */
  slashProgress: number | null;
  /** Attacker cut axis on the aim circle (radians); null if not slashing. */
  slashAngle: number | null;
  /** Guard aim on the circle (used for directional block). */
  guardX: number;
  guardY: number;
  bladeTip: Vec3;
  bladeBase: Vec3;
  /** Signed root X along the duel axis (arena center ≈ 0). */
  rootX: number;
  /** Soft rim: first outbound clamp sets this; next outbound push is ring-out. */
  onSoftEdge: boolean;
  /** Invulnerable during knockback only (i-frames). */
  invulnerable: boolean;
}

export interface CombatResolveInput {
  player: FighterSnapshot;
  dummy: FighterSnapshot;
  /** Arena midpoint along the duel axis. Defaults to 0. */
  arenaCenter?: number;
}

export interface CombatResolveResult {
  kind: CombatOutcomeKind;
  actorIdentityHex: string;
  targetIdentityHex: string;
  playerRootX: number;
  dummyRootX: number;
  winnerIdentityHex: string | null;
}

export function isInHitWindow(slashProgress: number | null | undefined): boolean {
  if (slashProgress == null || !Number.isFinite(slashProgress)) return false;
  return slashProgress >= HIT_WINDOW_START && slashProgress <= HIT_WINDOW_END;
}

/** Locked rule: no slash while block is held. */
export function canSlashWhileBlocking(blocking: boolean): boolean {
  return !blocking;
}

export function guardAngleRad(guardX: number, guardY: number): number {
  return Math.atan2(guardY, guardX);
}

export function angleDeltaRad(a: number, b: number): number {
  let delta = a - b;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function isDirectionalBlockSuccess(
  guardX: number,
  guardY: number,
  slashAngle: number,
  toleranceDeg: number = BLOCK_ANGLE_DEG,
): boolean {
  const guard = guardAngleRad(guardX, guardY);
  const deltaDeg = Math.abs(angleDeltaRad(guard, slashAngle)) * (180 / Math.PI);
  return deltaDeg <= toleranceDeg;
}

export function bladeDistance(a: FighterSnapshot, b: FighterSnapshot): number {
  const midA = bladeMidpoint(a);
  const midB = bladeMidpoint(b);
  return Math.hypot(midA.x - midB.x, midA.y - midB.y, midA.z - midB.z);
}

function bladeMidpoint(fighter: FighterSnapshot): Vec3 {
  return {
    x: (fighter.bladeTip.x + fighter.bladeBase.x) * 0.5,
    y: (fighter.bladeTip.y + fighter.bladeBase.y) * 0.5,
    z: (fighter.bladeTip.z + fighter.bladeBase.z) * 0.5,
  };
}

function isSlashingInWindow(fighter: FighterSnapshot): boolean {
  if (fighter.blocking) return false; // no-slash-while-block at this layer
  return isInHitWindow(fighter.slashProgress);
}

/** Blade tip/segment vs body capsule only — no seat-proximity fallback. */
function hitConnects(attacker: FighterSnapshot, defender: FighterSnapshot): boolean {
  return bladeHitsBody(attacker.bladeBase, attacker.bladeTip, defender.rootX);
}

/**
 * Apply signed knockback along the duel axis with soft-edge ring-out rules.
 * Callers choose the physical direction; inward movement clears soft-edge state.
 */
export function applySoftEdgeKnockback(
  rootX: number,
  onSoftEdge: boolean,
  directionSign: number,
  arenaCenter: number = 0,
  distance: number = KNOCKBACK_M,
): { rootX: number; onSoftEdge: boolean; ringedOut: boolean } {
  const sign = directionSign < 0 ? -1 : 1;
  const proposed = rootX + sign * distance;
  const proposedOffset = proposed - arenaCenter;
  const absOffset = Math.abs(proposedOffset);

  if (absOffset <= ARENA_RADIUS) {
    return { rootX: proposed, onSoftEdge: false, ringedOut: false };
  }

  const clamped = arenaCenter + Math.sign(proposedOffset || sign) * ARENA_RADIUS;
  if (onSoftEdge) {
    return { rootX: clamped, onSoftEdge: true, ringedOut: true };
  }
  return { rootX: clamped, onSoftEdge: true, ringedOut: false };
}

function outboundSign(rootX: number, arenaCenter: number): number {
  const offset = rootX - arenaCenter;
  if (offset === 0) return 1;
  return Math.sign(offset);
}

/** Direction from the opponent toward this fighter, with a stable overlap fallback. */
function awayFromOpponentSign(
  selfX: number,
  opponentX: number,
  arenaCenter: number,
): number {
  const separation = selfX - opponentX;
  return separation === 0 ? outboundSign(selfX, arenaCenter) : Math.sign(separation);
}

function advanceToward(selfX: number, opponentX: number, distance: number = ADVANCE_M): number {
  const dir = Math.sign(opponentX - selfX) || 1;
  return selfX + dir * distance;
}

type AxisPair = { playerRootX: number; dummyRootX: number };

function pairRoots(
  player: FighterSnapshot,
  dummy: FighterSnapshot,
  playerX: number,
  dummyX: number,
): AxisPair {
  return { playerRootX: playerX, dummyRootX: dummyX };
}

/**
 * Host-authoritative combat resolution for one tick.
 * Returns null when nothing connects.
 *
 * Priority: (1) block check when one blocks + one slashes
 *           (2) clash when both slash in-window with close blades
 *           (3) otherwise hit if in window and in reach
 */
export function resolveCombat(input: CombatResolveInput): CombatResolveResult | null {
  const arenaCenter = input.arenaCenter ?? 0;
  const player = input.player;
  const dummy = input.dummy;

  const playerSlashing = isSlashingInWindow(player);
  const dummySlashing = isSlashingInWindow(dummy);

  // --- Priority 1: one blocking + one slashing → directional block check ---
  if (playerSlashing && dummy.blocking && !dummySlashing) {
    return resolveBlockOrHit(player, dummy, true, arenaCenter);
  }
  if (dummySlashing && player.blocking && !playerSlashing) {
    return resolveBlockOrHit(dummy, player, false, arenaCenter);
  }

  // --- Priority 2: both slashing in window + blade proximity → clash ---
  if (playerSlashing && dummySlashing && bladeDistance(player, dummy) < CLASH_BLADE_DIST) {
    if (player.invulnerable || dummy.invulnerable) return null;

    const pKnock = applySoftEdgeKnockback(
      player.rootX,
      player.onSoftEdge,
      awayFromOpponentSign(player.rootX, dummy.rootX, arenaCenter),
      arenaCenter,
    );
    const dKnock = applySoftEdgeKnockback(
      dummy.rootX,
      dummy.onSoftEdge,
      awayFromOpponentSign(dummy.rootX, player.rootX, arenaCenter),
      arenaCenter,
    );
    const playerX = advanceToward(pKnock.rootX, dKnock.rootX);
    const dummyX = advanceToward(dKnock.rootX, pKnock.rootX);
    return finalize(
      "clash",
      player.identityHex,
      dummy.identityHex,
      pairRoots(player, dummy, playerX, dummyX),
      pKnock.ringedOut ? dummy.identityHex : dKnock.ringedOut ? player.identityHex : null,
      pKnock.ringedOut || dKnock.ringedOut,
    );
  }

  // --- Priority 3: single slash hit ---
  if (playerSlashing && !dummySlashing) {
    return resolveHit(player, dummy, true, arenaCenter);
  }
  if (dummySlashing && !playerSlashing) {
    return resolveHit(dummy, player, false, arenaCenter);
  }

  return null;
}

function resolveBlockOrHit(
  attacker: FighterSnapshot,
  defender: FighterSnapshot,
  attackerIsPlayer: boolean,
  arenaCenter: number,
): CombatResolveResult | null {
  if (!hitConnects(attacker, defender)) return null;
  if (defender.invulnerable) return null;

  const slashAngle = attacker.slashAngle;
  const blockOk =
    defender.blockingBeforeWindow &&
    slashAngle != null &&
    isDirectionalBlockSuccess(defender.guardX, defender.guardY, slashAngle);

  if (blockOk) {
    const knock = applySoftEdgeKnockback(
      attacker.rootX,
      attacker.onSoftEdge,
      awayFromOpponentSign(attacker.rootX, defender.rootX, arenaCenter),
      arenaCenter,
    );
    const playerX = attackerIsPlayer ? knock.rootX : defender.rootX;
    const dummyX = attackerIsPlayer ? defender.rootX : knock.rootX;
    return finalize(
      "blocked",
      attacker.identityHex,
      defender.identityHex,
      { playerRootX: playerX, dummyRootX: dummyX },
      knock.ringedOut ? defender.identityHex : null,
      knock.ringedOut,
    );
  }

  return resolveHit(attacker, defender, attackerIsPlayer, arenaCenter);
}

function resolveHit(
  attacker: FighterSnapshot,
  defender: FighterSnapshot,
  attackerIsPlayer: boolean,
  arenaCenter: number,
): CombatResolveResult | null {
  if (!hitConnects(attacker, defender)) return null;
  if (defender.invulnerable) return null;

  const knock = applySoftEdgeKnockback(
    defender.rootX,
    defender.onSoftEdge,
    awayFromOpponentSign(defender.rootX, attacker.rootX, arenaCenter),
    arenaCenter,
  );
  const advanced = advanceToward(attacker.rootX, knock.rootX);

  const playerX = attackerIsPlayer ? advanced : knock.rootX;
  const dummyX = attackerIsPlayer ? knock.rootX : advanced;

  return finalize(
    "hit",
    attacker.identityHex,
    defender.identityHex,
    { playerRootX: playerX, dummyRootX: dummyX },
    knock.ringedOut ? attacker.identityHex : null,
    knock.ringedOut,
  );
}

function finalize(
  kind: CombatOutcomeKind,
  actorIdentityHex: string,
  targetIdentityHex: string,
  roots: AxisPair,
  winnerIdentityHex: string | null,
  ringedOut: boolean,
): CombatResolveResult {
  return {
    kind: ringedOut ? "ringout" : kind,
    actorIdentityHex,
    targetIdentityHex,
    playerRootX: roots.playerRootX,
    dummyRootX: roots.dummyRootX,
    winnerIdentityHex: ringedOut ? winnerIdentityHex : null,
  };
}

/** @deprecated Prefer `resolveCombat` — kept for callers that used the tick name. */
export const resolveCombatTick = resolveCombat;
