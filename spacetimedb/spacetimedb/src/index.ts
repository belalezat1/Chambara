import { SenderError, schema, table, t } from "spacetimedb/server";

const ROOM_RE = /^[A-Z0-9]{6}$/;
const PRIMARY_GRIP = "primary-grip";
const OUTCOME_KINDS = new Set(["hit", "clash", "blocked", "ringout"]);
const MATCH_PHASES = new Set([
  "Idle",
  "Intro",
  "Countdown",
  "WalkIn",
  "Fighting",
  "RoundEnd",
  "MatchEnd",
]);

const match = table(
  {
    name: "match",
    public: true,
  },
  {
    roomCode: t.string().primaryKey(),
    hostIdentity: t.identity(),
    createdMs: t.u64(),
  },
);

const matchPlayer = table(
  {
    name: "match_player",
    public: true,
  },
  {
    identity: t.identity().primaryKey(),
    roomCode: t.string().index("btree"),
    joinedMs: t.u64(),
  },
);

/** Latest primary-grip pose for a player (world space on the publisher). */
const swordPose = table(
  {
    name: "sword_pose",
    public: true,
  },
  {
    identity: t.identity().primaryKey(),
    roomCode: t.string().index("btree"),
    type: t.string(),
    posX: t.f32(),
    posY: t.f32(),
    posZ: t.f32(),
    rotX: t.f32(),
    rotY: t.f32(),
    rotZ: t.f32(),
    rotW: t.f32(),
    sessionGeneration: t.u32(),
    sequence: t.u32(),
    updatedMs: t.u64(),
  },
);

const combatIntent = table(
  {
    name: "combat_intent",
    public: true,
  },
  {
    identity: t.identity().primaryKey(),
    roomCode: t.string().index("btree"),
    blocking: t.bool(),
    slashSeq: t.u32(),
    guardX: t.f32(),
    guardY: t.f32(),
    updatedMs: t.u64(),
  },
);

const combatOutcome = table(
  {
    name: "combat_outcome",
    public: true,
  },
  {
    roomCode: t.string().primaryKey(),
    seq: t.u32(),
    kind: t.string(),
    actorIdentity: t.identity(),
    targetIdentity: t.identity(),
    playerRootX: t.f32(),
    dummyRootX: t.f32(),
    winnerIdentity: t.option(t.identity()),
    updatedMs: t.u64(),
  },
);

/** Host-authoritative match phase so guest countdown/Fighting stay in lockstep. */
const matchPhase = table(
  {
    name: "match_phase",
    public: true,
  },
  {
    roomCode: t.string().primaryKey(),
    seq: t.u32(),
    phase: t.string(),
    countdownLabel: t.string(),
    roundIndex: t.u32(),
    p1Wins: t.u32(),
    p2Wins: t.u32(),
    matchWinner: t.string(),
    playerRootX: t.f32(),
    dummyRootX: t.f32(),
    updatedMs: t.u64(),
  },
);

const spacetimedb = schema({
  match,
  matchPlayer,
  swordPose,
  combatIntent,
  combatOutcome,
  matchPhase,
});
export default spacetimedb;

function nowMs(ctx: { timestamp: { microsSinceUnixEpoch: bigint } }): bigint {
  return ctx.timestamp.microsSinceUnixEpoch / 1000n;
}

function normalizeRoomCode(roomCode: string): string {
  const room = roomCode.trim().toUpperCase();
  if (!ROOM_RE.test(room)) {
    throw new SenderError("Room code must be 6 letters or digits.");
  }
  return room;
}

function countPlayersInRoom(
  ctx: { db: { matchPlayer: { roomCode: { filter: (code: string) => Iterable<unknown> } } } },
  roomCode: string,
): number {
  return [...ctx.db.matchPlayer.roomCode.filter(roomCode)].length;
}

function emptyPose(
  identity: { toHexString?: () => string },
  roomCode: string,
  ms: bigint,
) {
  return {
    identity: identity as never,
    roomCode,
    type: PRIMARY_GRIP,
    posX: 0,
    posY: 0,
    posZ: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    rotW: 1,
    sessionGeneration: 0,
    sequence: 0,
    updatedMs: ms,
  };
}

function requireHost(
  ctx: {
    sender: { equals: (other: unknown) => boolean };
    db: { match: { roomCode: { find: (code: string) => { hostIdentity: unknown } | null | undefined } }; matchPlayer: { identity: { find: (id: unknown) => { roomCode: string } | null | undefined } } };
  },
): { roomCode: string } {
  const player = ctx.db.matchPlayer.identity.find(ctx.sender);
  if (!player) throw new SenderError("Join a match first.");
  const matchRow = ctx.db.match.roomCode.find(player.roomCode);
  if (!matchRow || !matchRow.hostIdentity.equals(ctx.sender)) {
    throw new SenderError("Only the host may publish match authority.");
  }
  return { roomCode: player.roomCode };
}

export const init = spacetimedb.init((_ctx) => {});

export const onConnect = spacetimedb.clientConnected((_ctx) => {});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const player = ctx.db.matchPlayer.identity.find(ctx.sender);
  if (!player) return;
  const roomCode = player.roomCode;
  ctx.db.swordPose.identity.delete(ctx.sender);
  ctx.db.combatIntent.identity.delete(ctx.sender);
  ctx.db.matchPlayer.identity.delete(ctx.sender);
  if (countPlayersInRoom(ctx, roomCode) === 0) {
    ctx.db.match.roomCode.delete(roomCode);
    ctx.db.combatOutcome.roomCode.delete(roomCode);
    ctx.db.matchPhase.roomCode.delete(roomCode);
  }
});

export const createOrJoinMatch = spacetimedb.reducer(
  { roomCode: t.string() },
  (ctx, { roomCode: rawRoom }) => {
    const roomCode = normalizeRoomCode(rawRoom);
    const existingPlayer = ctx.db.matchPlayer.identity.find(ctx.sender);
    if (existingPlayer) {
      if (existingPlayer.roomCode === roomCode) return;
      throw new SenderError("Already in another match. Leave first.");
    }

    let matchRow = ctx.db.match.roomCode.find(roomCode);
    const ms = nowMs(ctx);
    if (!matchRow) {
      matchRow = ctx.db.match.insert({
        roomCode,
        hostIdentity: ctx.sender,
        createdMs: ms,
      });
    } else if (countPlayersInRoom(ctx, roomCode) >= 2) {
      throw new SenderError("Match is full.");
    }

    ctx.db.matchPlayer.insert({
      identity: ctx.sender,
      roomCode,
      joinedMs: ms,
    });
    ctx.db.swordPose.insert(emptyPose(ctx.sender, roomCode, ms));
    ctx.db.combatIntent.insert({
      identity: ctx.sender,
      roomCode,
      blocking: false,
      slashSeq: 0,
      guardX: 0,
      guardY: 1,
      updatedMs: ms,
    });
  },
);

export const leaveMatch = spacetimedb.reducer((ctx) => {
  const player = ctx.db.matchPlayer.identity.find(ctx.sender);
  if (!player) return;
  const roomCode = player.roomCode;
  ctx.db.swordPose.identity.delete(ctx.sender);
  ctx.db.combatIntent.identity.delete(ctx.sender);
  ctx.db.matchPlayer.identity.delete(ctx.sender);
  if (countPlayersInRoom(ctx, roomCode) === 0) {
    ctx.db.match.roomCode.delete(roomCode);
    ctx.db.combatOutcome.roomCode.delete(roomCode);
    ctx.db.matchPhase.roomCode.delete(roomCode);
  }
});

export const updateSwordPose = spacetimedb.reducer(
  {
    type: t.string(),
    position: t.array(t.f32()),
    rotation: t.array(t.f32()),
    sessionGeneration: t.u32(),
    sequence: t.u32(),
  },
  (ctx, { type, position, rotation, sessionGeneration, sequence }) => {
    const player = ctx.db.matchPlayer.identity.find(ctx.sender);
    if (!player) throw new SenderError("Join a match before publishing pose.");
    if (type !== PRIMARY_GRIP) {
      throw new SenderError('type must be "primary-grip".');
    }
    if (position.length !== 3 || rotation.length !== 4) {
      throw new SenderError("position must be [x,y,z] and rotation [x,y,z,w].");
    }
    if (
      !position.every((v) => Number.isFinite(v)) ||
      !rotation.every((v) => Number.isFinite(v))
    ) {
      throw new SenderError("position and rotation must be finite.");
    }
    const row = {
      identity: ctx.sender,
      roomCode: player.roomCode,
      type: PRIMARY_GRIP,
      posX: position[0]!,
      posY: position[1]!,
      posZ: position[2]!,
      rotX: rotation[0]!,
      rotY: rotation[1]!,
      rotZ: rotation[2]!,
      rotW: rotation[3]!,
      sessionGeneration,
      sequence,
      updatedMs: nowMs(ctx),
    };
    const existing = ctx.db.swordPose.identity.find(ctx.sender);
    if (existing) ctx.db.swordPose.identity.update(row);
    else ctx.db.swordPose.insert(row);
  },
);

export const upsertCombatIntent = spacetimedb.reducer(
  {
    blocking: t.bool(),
    slashSeq: t.u32(),
    guardX: t.f32(),
    guardY: t.f32(),
  },
  (ctx, { blocking, slashSeq, guardX, guardY }) => {
    const player = ctx.db.matchPlayer.identity.find(ctx.sender);
    if (!player) throw new SenderError("Join a match before publishing intent.");
    if (![guardX, guardY].every(Number.isFinite)) {
      throw new SenderError("guard must be finite.");
    }
    const row = {
      identity: ctx.sender,
      roomCode: player.roomCode,
      blocking,
      slashSeq,
      guardX,
      guardY,
      updatedMs: nowMs(ctx),
    };
    const existing = ctx.db.combatIntent.identity.find(ctx.sender);
    if (existing) ctx.db.combatIntent.identity.update(row);
    else ctx.db.combatIntent.insert(row);
  },
);

export const publishCombatOutcome = spacetimedb.reducer(
  {
    seq: t.u32(),
    kind: t.string(),
    actorIdentity: t.identity(),
    targetIdentity: t.identity(),
    playerRootX: t.f32(),
    dummyRootX: t.f32(),
    winnerIdentity: t.option(t.identity()),
  },
  (ctx, args) => {
    const { roomCode } = requireHost(ctx);
    if (!OUTCOME_KINDS.has(args.kind)) {
      throw new SenderError("Invalid combat outcome kind.");
    }
    if (![args.playerRootX, args.dummyRootX].every(Number.isFinite)) {
      throw new SenderError("roots must be finite.");
    }
    const row = {
      roomCode,
      seq: args.seq,
      kind: args.kind,
      actorIdentity: args.actorIdentity,
      targetIdentity: args.targetIdentity,
      playerRootX: args.playerRootX,
      dummyRootX: args.dummyRootX,
      winnerIdentity: args.winnerIdentity,
      updatedMs: nowMs(ctx),
    };
    const existing = ctx.db.combatOutcome.roomCode.find(roomCode);
    if (existing) {
      if (args.seq <= existing.seq) return;
      ctx.db.combatOutcome.roomCode.update(row);
    } else {
      ctx.db.combatOutcome.insert(row);
    }
  },
);

export const publishMatchPhase = spacetimedb.reducer(
  {
    seq: t.u32(),
    phase: t.string(),
    countdownLabel: t.string(),
    roundIndex: t.u32(),
    p1Wins: t.u32(),
    p2Wins: t.u32(),
    matchWinner: t.string(),
    playerRootX: t.f32(),
    dummyRootX: t.f32(),
  },
  (ctx, args) => {
    const { roomCode } = requireHost(ctx);
    if (!MATCH_PHASES.has(args.phase)) {
      throw new SenderError("Invalid match phase.");
    }
    if (![args.playerRootX, args.dummyRootX].every(Number.isFinite)) {
      throw new SenderError("roots must be finite.");
    }
    const row = {
      roomCode,
      seq: args.seq,
      phase: args.phase,
      countdownLabel: args.countdownLabel,
      roundIndex: args.roundIndex,
      p1Wins: args.p1Wins,
      p2Wins: args.p2Wins,
      matchWinner: args.matchWinner,
      playerRootX: args.playerRootX,
      dummyRootX: args.dummyRootX,
      updatedMs: nowMs(ctx),
    };
    const existing = ctx.db.matchPhase.roomCode.find(roomCode);
    if (existing) {
      if (args.seq < existing.seq) return;
      ctx.db.matchPhase.roomCode.update(row);
    } else {
      ctx.db.matchPhase.insert(row);
    }
  },
);

export const resetMatchCombat = spacetimedb.reducer((ctx) => {
  const { roomCode } = requireHost(ctx);
  ctx.db.combatOutcome.roomCode.delete(roomCode);
  ctx.db.matchPhase.roomCode.delete(roomCode);
});
