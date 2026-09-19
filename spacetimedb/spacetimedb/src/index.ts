import { SenderError, schema, table, t } from "spacetimedb/server";

const ROOM_RE = /^[A-Z0-9]{6}$/;
const PRIMARY_GRIP = "primary-grip";

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

const spacetimedb = schema({ match, matchPlayer, swordPose });
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

export const init = spacetimedb.init((_ctx) => {});

export const onConnect = spacetimedb.clientConnected((_ctx) => {});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const player = ctx.db.matchPlayer.identity.find(ctx.sender);
  if (!player) return;
  const roomCode = player.roomCode;
  ctx.db.swordPose.identity.delete(ctx.sender);
  ctx.db.matchPlayer.identity.delete(ctx.sender);
  if (countPlayersInRoom(ctx, roomCode) === 0) {
    ctx.db.match.roomCode.delete(roomCode);
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
  },
);

export const leaveMatch = spacetimedb.reducer((ctx) => {
  const player = ctx.db.matchPlayer.identity.find(ctx.sender);
  if (!player) return;
  const roomCode = player.roomCode;
  ctx.db.swordPose.identity.delete(ctx.sender);
  ctx.db.matchPlayer.identity.delete(ctx.sender);
  if (countPlayersInRoom(ctx, roomCode) === 0) {
    ctx.db.match.roomCode.delete(roomCode);
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
