import { DbConnection, tables } from "../../module_bindings";
import type { Identity } from "spacetimedb";
import { normalizeRoomCode } from "../input/MotionTypes";
import {
  isPrimaryGripNetworkPose,
  PRIMARY_GRIP_MESSAGE_TYPE,
  type PrimaryGripNetworkPose,
} from "./PrimaryGripProtocol";
import type { CombatOutcomeKind } from "../combat/CombatConstants";
import { combatDebug, shortIdentity } from "./CombatDebug";
export type { PrimaryGripNetworkPose } from "./PrimaryGripProtocol";

export type MatchClientStatus = {
  connection: "idle" | "connecting" | "connected" | "error";
  roomCode: string;
  identityHex: string | null;
  isHost: boolean;
  playerCount: number;
  opponentConnected: boolean;
  hostReady: boolean;
  guestReady: boolean;
  error: string;
};

export type CombatIntentPublish = {
  blocking: boolean;
  slashSeq: number;
  guardX: number;
  guardY: number;
};

export type CombatOutcomeEvent = {
  roomCode: string;
  seq: number;
  kind: CombatOutcomeKind;
  actorIdentityHex: string;
  targetIdentityHex: string;
  playerRootX: number;
  dummyRootX: number;
  winnerIdentityHex: string | null;
  /** Client-enriched identity defining the outcome's player/dummy frame. */
  hostIdentityHex?: string | null;
};

export type RemoteCombatIntent = {
  identityHex: string;
  blocking: boolean;
  slashSeq: number;
  guardX: number;
  guardY: number;
};

export type MatchClientListeners = {
  onStatus: (status: MatchClientStatus) => void;
  onRemotePose: (pose: PrimaryGripNetworkPose | null) => void;
  onCombatOutcome?: (outcome: CombatOutcomeEvent) => void;
  onCombatIntent?: (intent: RemoteCombatIntent) => void;
};

const TOKEN_KEY = "chambara.spacetimedb.token";
const PRIMARY_GRIP = PRIMARY_GRIP_MESSAGE_TYPE;
const OUTCOME_KINDS = new Set<string>(["hit", "clash", "blocked", "ringout"]);

function defaultUri(): string {
  return (import.meta.env.VITE_SPACETIME_URI as string | undefined)?.trim() ||
    "https://maincloud.spacetimedb.com";
}

function defaultDatabase(): string {
  return (import.meta.env.VITE_SPACETIME_DB as string | undefined)?.trim() || "chambara";
}

export function createInitialMatchStatus(): MatchClientStatus {
  return {
    connection: "idle",
    roomCode: "",
    identityHex: null,
    isHost: false,
    playerCount: 0,
    opponentConnected: false,
    hostReady: false,
    guestReady: false,
    error: "",
  };
}

function optionalIdentityHex(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object" && value !== null && "tag" in value) {
    const tagged = value as { tag: string; value?: Identity };
    if (tagged.tag === "none" || tagged.tag === "None") return null;
    if ((tagged.tag === "some" || tagged.tag === "Some") && tagged.value) {
      return tagged.value.toHexString();
    }
  }
  if (typeof value === "object" && value !== null && "toHexString" in value) {
    return (value as Identity).toHexString();
  }
  return null;
}

/** Laptop↔laptop match sync. Phone pairing stays on the local Vite relay. */
export class SpacetimeMatchClient {
  private conn: DbConnection | null = null;
  private identity: Identity | null = null;
  private roomCode = "";
  private seat: "host" | "guest" | null = null;
  private status = createInitialMatchStatus();
  private readonly listeners: MatchClientListeners;
  private readonly uri: string;
  private readonly database: string;
  private lastPublishAt = 0;
  private lastIntentAt = 0;
  private lastOutcomeSeq = -1;
  private readonly identityByHex = new Map<string, Identity>();
  private rosterRefreshTimers = new Set<number>();
  private rosterRefreshGeneration = 0;

  constructor(listeners: MatchClientListeners, uri = defaultUri(), database = defaultDatabase()) {
    this.listeners = listeners;
    this.uri = uri;
    this.database = database;
  }

  getStatus(): MatchClientStatus {
    return { ...this.status };
  }

  getUri(): string {
    return this.uri;
  }

  getDatabase(): string {
    return this.database;
  }

  getIdentityHex(): string | null {
    return this.identity?.toHexString() ?? null;
  }

  getOpponentIdentityHex(): string | null {
    if (!this.conn || !this.identity || !this.roomCode) return null;
    for (const player of this.conn.db.matchPlayer.iter()) {
      if (player.roomCode !== this.roomCode) continue;
      if (!player.identity.equals(this.identity)) return player.identity.toHexString();
    }
    return null;
  }

  async join(rawRoom: string, requestedSeat: "host" | "guest" = "guest"): Promise<void> {
    const roomCode = normalizeRoomCode(rawRoom);
    if (!roomCode) {
      this.setStatus({ error: "Enter a valid 6-character match code.", connection: "error" });
      return;
    }
    await this.ensureConnected();
    if (!this.conn) return;
    this.roomCode = roomCode;
    this.seat = requestedSeat;
    combatDebug("match.join", { roomCode });
    this.lastOutcomeSeq = -1;
    // Optimistic seat: room is active for this client even before the
    // subscription cache has the match_player row (avoids sticky 0/2).
    this.setStatus({
      roomCode,
      error: "",
      connection: "connected",
      playerCount: Math.max(1, this.status.playerCount),
      isHost: requestedSeat === "host" ? true : this.status.isHost,
    });
    try {
      await this.conn.reducers.createOrJoinMatch({ roomCode });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Do not leave the UI in a fake active lobby when the reducer rejected
      // the join (for example, a full room or an identity already in a room).
      this.clearRosterRefreshSchedule();
      this.roomCode = "";
      this.seat = null;
      this.lastOutcomeSeq = -1;
      this.setStatus({
        roomCode: "",
        isHost: false,
        playerCount: 0,
        opponentConnected: false,
        hostReady: false,
        guestReady: false,
        error: message,
        connection: "error",
      });
      throw error;
    }
    this.refreshRoster();
    this.refreshCombatState();
    // The reducer completes before the subscription cache necessarily has the
    // inserted rows. Reconcile a few times so a guest does not remain at 0/2
    // when the initial snapshot arrives just after the join call resolves.
    this.scheduleRosterRefresh();
  }

  leave(): void {
    if (this.roomCode) combatDebug("match.leave", { roomCode: this.roomCode });
    this.clearRosterRefreshSchedule();
    try {
      void this.conn?.reducers.leaveMatch({});
    } catch {
      // ignore
    }
    this.roomCode = "";
    this.seat = null;
    this.lastOutcomeSeq = -1;
    this.listeners.onRemotePose(null);
    this.setStatus({
      roomCode: "",
      isHost: false,
      playerCount: 0,
      opponentConnected: false,
      hostReady: false,
      guestReady: false,
      error: "",
      connection: "idle",
    });
  }

  setReady(ready: boolean): void {
    if (!this.conn || !this.roomCode) return;
    const reducers = this.conn.reducers as { setReady?: (args: { ready: boolean }) => Promise<void> };
    if (typeof reducers.setReady !== "function") return;
    try {
      // Soft-fail when Maincloud has not published additive setReady yet — Lobby
      // falls back to opponentConnected after a short wait.
      reducers.setReady({ ready: Boolean(ready) }).catch(() => undefined);
    } catch {
      // ignore
    }
  }

  publishPose(pose: PrimaryGripNetworkPose, now = performance.now()): void {
    if (!this.conn || !this.roomCode) return;
    if (pose.type !== PRIMARY_GRIP) return;
    if (now - this.lastPublishAt < 1000 / 60) return;
    this.lastPublishAt = now;
    try {
      this.conn.reducers.updateSwordPose({
        type: pose.type,
        position: [...pose.position],
        rotation: [...pose.rotation],
        sessionGeneration: pose.sessionGeneration,
        sequence: pose.sequence,
      }).catch(() => undefined);
    } catch {
      // Drop transient publish errors; next tick retries.
    }
  }

  publishCombatIntent(intent: CombatIntentPublish, now = performance.now()): void {
    if (!this.conn || !this.roomCode) return;
    if (now - this.lastIntentAt < 1000 / 60) return;
    this.lastIntentAt = now;
    try {
      this.conn.reducers.upsertCombatIntent({
        blocking: intent.blocking,
        slashSeq: intent.slashSeq,
        guardX: intent.guardX,
        guardY: intent.guardY,
      }).catch((error: unknown) => this.reportCombatPublishError("intent", error));
    } catch (error) {
      this.reportCombatPublishError("intent", error);
    }
  }

  publishCombatOutcome(outcome: Omit<CombatOutcomeEvent, "roomCode"> & { roomCode?: string }): void {
    if (!this.conn || !this.roomCode || !this.status.isHost) return;
    const actor = this.identityByHex.get(outcome.actorIdentityHex);
    const target = this.identityByHex.get(outcome.targetIdentityHex);
    if (!actor || !target) return;
    let winnerIdentity: Identity | undefined;
    if (outcome.winnerIdentityHex) {
      winnerIdentity = this.identityByHex.get(outcome.winnerIdentityHex);
      if (!winnerIdentity) return;
    }
    try {
      combatDebug("outcome.publish", {
        roomCode: this.roomCode,
        seq: outcome.seq,
        kind: outcome.kind,
        actor: shortIdentity(outcome.actorIdentityHex),
        target: shortIdentity(outcome.targetIdentityHex),
        playerRootX: outcome.playerRootX,
        dummyRootX: outcome.dummyRootX,
      });
      this.conn.reducers.publishCombatOutcome({
        seq: outcome.seq,
        kind: outcome.kind,
        actorIdentity: actor,
        targetIdentity: target,
        playerRootX: outcome.playerRootX,
        dummyRootX: outcome.dummyRootX,
        winnerIdentity: winnerIdentity ?? (undefined as never),
      }).catch((error: unknown) => this.reportCombatPublishError("outcome", error));
    } catch (error) {
      this.reportCombatPublishError("outcome", error);
    }
  }

  disconnect(): void {
    this.leave();
    this.conn?.disconnect();
    this.conn = null;
    this.identity = null;
    this.identityByHex.clear();
    this.setStatus(createInitialMatchStatus());
  }

  private async ensureConnected(): Promise<void> {
    if (this.conn) return;
    this.setStatus({ connection: "connecting", error: "" });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let timeoutId: number | null = null;
      const clearConnectTimeout = () => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        timeoutId = null;
      };
      const builder = DbConnection.builder()
        .withUri(this.uri)
        .withDatabaseName(this.database)
        .withToken(localStorage.getItem(TOKEN_KEY) ?? undefined)
        .onConnect((conn, identity, token) => {
          if (settled) {
            conn.disconnect();
            return;
          }
          this.conn = conn;
          this.identity = identity;
          this.identityByHex.set(identity.toHexString(), identity);
          if (token) localStorage.setItem(TOKEN_KEY, token);
          this.setStatus({
            connection: "connected",
            identityHex: identity.toHexString(),
            error: "",
          });
          combatDebug("socket.connected", {
            identity: shortIdentity(identity.toHexString()),
            database: this.database,
          });
          conn.db.swordPose.onInsert((_ctx, row) => this.handlePoseRow(row));
          conn.db.swordPose.onUpdate((_ctx, _old, row) => this.handlePoseRow(row));
          conn.db.swordPose.onDelete((_ctx, row) => {
            if (
              this.roomCode &&
              row.roomCode === this.roomCode &&
              this.identity &&
              !row.identity.equals(this.identity)
            ) {
              this.listeners.onRemotePose(null);
            }
            this.refreshRoster();
          });
          conn.db.matchPlayer.onInsert(() => this.refreshRoster());
          conn.db.matchPlayer.onUpdate(() => this.refreshRoster());
          conn.db.matchPlayer.onDelete(() => this.refreshRoster());
          conn.db.match.onInsert(() => this.refreshRoster());
          conn.db.match.onUpdate(() => this.refreshRoster());
          conn.db.combatIntent.onInsert((_ctx, row) => this.handleIntentRow(row));
          conn.db.combatIntent.onUpdate((_ctx, _old, row) => this.handleIntentRow(row));
          conn.db.combatIntent.onDelete((_ctx, row) => {
            if (
              this.roomCode &&
              row.roomCode === this.roomCode &&
              this.identity &&
              !row.identity.equals(this.identity)
            ) {
              this.listeners.onCombatIntent?.({
                identityHex: row.identity.toHexString(),
                blocking: false,
                slashSeq: row.slashSeq,
                guardX: 0,
                guardY: 1,
              });
            }
          });
          conn.db.combatOutcome.onInsert((_ctx, row) => this.handleOutcomeRow(row));
          conn.db.combatOutcome.onUpdate((_ctx, _old, row) => this.handleOutcomeRow(row));
          conn.db.combatOutcome.onDelete((_ctx, row) => {
            if (this.roomCode && row.roomCode === this.roomCode) {
              this.lastOutcomeSeq = -1;
            }
          });
          conn.subscriptionBuilder()
            .onApplied(() => {
              combatDebug("subscription.applied", { database: this.database });
              this.refreshRoster();
              this.refreshCombatState();
              if (!settled) {
                settled = true;
                clearConnectTimeout();
                resolve();
              }
            })
            .onError((ctx) => {
              const error = ctx.event;
              const message = error instanceof Error ? error.message : String(error);
              combatDebug("subscription.error", { message });
              this.setStatus({ connection: "error", error: message });
              if (!settled) {
                settled = true;
                clearConnectTimeout();
                reject(error instanceof Error ? error : new Error(message));
              }
            })
            .subscribe([
              tables.match,
              tables.matchPlayer,
              tables.swordPose,
              tables.combatIntent,
              tables.combatOutcome,
            ]);
        })
        .onConnectError((_ctx, error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.setStatus({ connection: "error", error: message });
          combatDebug("socket.error", { message });
          if (!settled) {
            settled = true;
            clearConnectTimeout();
            reject(error instanceof Error ? error : new Error(message));
          }
        })
        .onDisconnect(() => {
          if (timedOut) return;
          combatDebug("socket.disconnected", { roomCode: this.roomCode });
          if (!settled) {
            settled = true;
            clearConnectTimeout();
            reject(new Error("Disconnected before the match subscription was ready."));
          }
          this.clearRosterRefreshSchedule();
          this.conn = null;
          this.seat = null;
          this.setStatus({
            connection: "idle",
            opponentConnected: false,
            playerCount: 0,
            isHost: false,
            hostReady: false,
            guestReady: false,
          });
          this.listeners.onRemotePose(null);
        });
      timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        timedOut = true;
        const error = new Error("Timed out connecting to the match server.");
        this.setStatus({ connection: "error", error: error.message });
        combatDebug("socket.timeout", { database: this.database });
        reject(error);
      }, 15_000);
      builder.build();
    });
  }

  private handlePoseRow(row: {
    identity: Identity;
    roomCode: string;
    type: string;
    posX: number;
    posY: number;
    posZ: number;
    rotX: number;
    rotY: number;
    rotZ: number;
    rotW: number;
    sessionGeneration: number;
    sequence: number;
  }): void {
    if (!this.identity || row.identity.equals(this.identity)) return;
    if (!this.roomCode || row.roomCode !== this.roomCode) return;
    if (row.type !== PRIMARY_GRIP) return;
    const pose = {
      type: PRIMARY_GRIP,
      position: [row.posX, row.posY, row.posZ],
      rotation: [row.rotX, row.rotY, row.rotZ, row.rotW],
      sessionGeneration: row.sessionGeneration,
      sequence: row.sequence,
    };
    if (isPrimaryGripNetworkPose(pose)) this.listeners.onRemotePose(pose);
  }

  private handleIntentRow(row: {
    identity: Identity;
    roomCode: string;
    blocking: boolean;
    slashSeq: number;
    guardX: number;
    guardY: number;
  }): void {
    this.identityByHex.set(row.identity.toHexString(), row.identity);
    if (!this.identity || row.identity.equals(this.identity)) return;
    if (!this.roomCode || row.roomCode !== this.roomCode) return;
    const intent = {
      identityHex: row.identity.toHexString(),
      blocking: row.blocking,
      slashSeq: row.slashSeq,
      guardX: row.guardX,
      guardY: row.guardY,
    };
    this.listeners.onCombatIntent?.(intent);
  }

  private handleOutcomeRow(row: {
    roomCode: string;
    seq: number;
    kind: string;
    actorIdentity: Identity;
    targetIdentity: Identity;
    playerRootX: number;
    dummyRootX: number;
    winnerIdentity: unknown;
  }): void {
    if (!this.roomCode || row.roomCode !== this.roomCode) return;
    if (!OUTCOME_KINDS.has(row.kind)) return;
    if (row.seq <= this.lastOutcomeSeq) return;
    this.lastOutcomeSeq = row.seq;
    this.identityByHex.set(row.actorIdentity.toHexString(), row.actorIdentity);
    this.identityByHex.set(row.targetIdentity.toHexString(), row.targetIdentity);
    const outcome: CombatOutcomeEvent = {
      roomCode: row.roomCode,
      seq: row.seq,
      kind: row.kind as CombatOutcomeKind,
      actorIdentityHex: row.actorIdentity.toHexString(),
      targetIdentityHex: row.targetIdentity.toHexString(),
      playerRootX: row.playerRootX,
      dummyRootX: row.dummyRootX,
      winnerIdentityHex: optionalIdentityHex(row.winnerIdentity),
      hostIdentityHex:
        this.conn?.db.match.roomCode.find(row.roomCode)?.hostIdentity.toHexString() ?? null,
    };
    combatDebug("outcome.receive", {
      roomCode: outcome.roomCode,
      seq: outcome.seq,
      kind: outcome.kind,
      actor: shortIdentity(outcome.actorIdentityHex),
      target: shortIdentity(outcome.targetIdentityHex),
      playerRootX: outcome.playerRootX,
      dummyRootX: outcome.dummyRootX,
      host: shortIdentity(outcome.hostIdentityHex ?? null),
    });
    this.listeners.onCombatOutcome?.(outcome);
  }

  private refreshRoster(): void {
    if (!this.conn || !this.identity) return;
    if (!this.roomCode) {
      this.setStatus({
        playerCount: 0,
        opponentConnected: false,
        isHost: false,
        hostReady: false,
        guestReady: false,
      });
      return;
    }
    let iterError: string | null = null;
    let rawIterCount = 0;
    let players: Array<{ identity: Identity; roomCode: string; ready?: boolean }> = [];
    try {
      const all = [...this.conn.db.matchPlayer.iter()];
      rawIterCount = all.length;
      players = all.filter((player) => player.roomCode === this.roomCode).map((player) => ({
        identity: player.identity,
        roomCode: player.roomCode,
        // Maincloud may not have additive `ready` yet — never require it to decode rows.
        ready: (player as { ready?: boolean }).ready,
      }));
    } catch (error) {
      iterError = error instanceof Error ? error.message : String(error);
    }
    for (const player of players) {
      this.identityByHex.set(player.identity.toHexString(), player.identity);
    }
    const matchRow = this.roomCode
      ? this.conn.db.match.roomCode.find(this.roomCode)
      : undefined;
    if (matchRow) {
      this.identityByHex.set(matchRow.hostIdentity.toHexString(), matchRow.hostIdentity);
    }
    const opponentConnected = players.some((player) => !player.identity.equals(this.identity!));
    const hostIdentity = matchRow?.hostIdentity;
    const hostPlayer = hostIdentity
      ? players.find((player) => player.identity.equals(hostIdentity))
      : undefined;
    const guestPlayer = hostIdentity
      ? players.find((player) => !player.identity.equals(hostIdentity))
      : undefined;
    const nextCount = players.length || (this.roomCode ? 1 : 0);
    if (
      players.length !== this.status.playerCount ||
      opponentConnected !== this.status.opponentConnected
    ) {
      combatDebug("roster.changed", {
        roomCode: this.roomCode,
        playerCount: players.length,
        opponentConnected,
        isHost: Boolean(matchRow && matchRow.hostIdentity.equals(this.identity)),
      });
    }
    this.setStatus({
      // After createOrJoinMatch succeeds, this client is definitely one of
      // the players even if the subscription cache has not delivered its row
      // yet. Use that local knowledge while waiting for the authoritative
      // snapshot, then replace it with the replicated count below.
      playerCount: nextCount,
      opponentConnected,
      isHost: matchRow
        ? matchRow.hostIdentity.equals(this.identity)
        : this.seat === "host",
      hostReady: hostPlayer?.ready === true,
      guestReady: guestPlayer?.ready === true,
    });
  }

  private refreshCombatState(): void {
    if (!this.conn || !this.identity || !this.roomCode) return;
    for (const row of this.conn.db.combatIntent.iter()) {
      if (row.roomCode === this.roomCode && !row.identity.equals(this.identity)) {
        this.handleIntentRow(row);
      }
    }
    const outcome = this.conn.db.combatOutcome.roomCode.find(this.roomCode);
    if (outcome) this.handleOutcomeRow(outcome);
  }

  private reportCombatPublishError(kind: "intent" | "outcome", error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `Failed to publish combat ${kind}: ${detail}`;
    combatDebug("combat.publish.error", { kind, message: detail });
    if (this.status.error !== message) this.setStatus({ error: message });
  }

  private clearRosterRefreshSchedule(): void {
    this.rosterRefreshGeneration += 1;
    for (const timer of this.rosterRefreshTimers) window.clearTimeout(timer);
    this.rosterRefreshTimers.clear();
  }

  private scheduleRosterRefresh(): void {
    this.clearRosterRefreshSchedule();
    const generation = this.rosterRefreshGeneration;
    // Keep the retry window short, but long enough to cover a cold
    // connection's initial subscription snapshot.
    for (const delay of [0, 50, 150, 350, 750, 1_500]) {
      let timer = 0;
      timer = window.setTimeout(() => {
        this.rosterRefreshTimers.delete(timer);
        if (generation !== this.rosterRefreshGeneration) return;
        this.refreshRoster();
        this.refreshCombatState();
      }, delay);
      this.rosterRefreshTimers.add(timer);
    }
  }

  private setStatus(patch: Partial<MatchClientStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.onStatus(this.getStatus());
  }
}
