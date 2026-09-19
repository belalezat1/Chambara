export type QuaternionTuple = [number, number, number, number];

export type ControllerSource = "phone" | "simulation";

export interface ControllerSample {
  sessionGeneration: number;
  sequence: number;
  timestamp: number;
  quaternion: QuaternionTuple;
  /** Uncalibrated DeviceOrientation quaternion for physical diagnostics. */
  rawQuaternion?: QuaternionTuple;
  /** Absolute quaternion captured when the phone was recentered. */
  calibrationReferenceQuaternion?: QuaternionTuple;
  calibrated: boolean;
  source: ControllerSource;
  /** Cumulative slash counter; repeated samples cannot replay a cut. */
  slashCount?: number;
  /** Phone hold-to-block; when true the host must suppress new slashes. */
  blocking?: boolean;
}

export type RelayRole = "host" | "phone";
export type RelayConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "waiting"
  | "disconnected"
  | "error";
export type RelayStreamState = "idle" | "live" | "stale";

export interface RelayStatus {
  role: RelayRole;
  room: string;
  connection: RelayConnectionState;
  peerConnected: boolean;
  streamState: RelayStreamState;
  samplesPerSecond: number;
  sessionGeneration: number | null;
  lastSequence: number | null;
  sampleAgeMs: number | null;
  calibrated: boolean;
  quaternion: QuaternionTuple | null;
  rawQuaternion: QuaternionTuple | null;
  calibrationReferenceQuaternion: QuaternionTuple | null;
  relayRttMs: number | null;
  outOfOrderSamples: number;
  error: string | null;
}

export function isControllerSample(value: unknown): value is Omit<ControllerSample, "source"> & {
  source?: ControllerSource;
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const q = candidate.quaternion;
  return (
    typeof candidate.sessionGeneration === "number" &&
    Number.isInteger(candidate.sessionGeneration) &&
    candidate.sessionGeneration > 0 &&
    typeof candidate.sequence === "number" &&
    Number.isInteger(candidate.sequence) &&
    candidate.sequence >= 0 &&
    typeof candidate.timestamp === "number" &&
    Number.isFinite(candidate.timestamp) &&
    Array.isArray(q) &&
    q.length === 4 &&
    q.every((component) => typeof component === "number" && Number.isFinite(component)) &&
    (candidate.rawQuaternion === undefined ||
      (Array.isArray(candidate.rawQuaternion) &&
        candidate.rawQuaternion.length === 4 &&
        candidate.rawQuaternion.every(
          (component) => typeof component === "number" && Number.isFinite(component),
        ))) &&
    (candidate.calibrationReferenceQuaternion === undefined ||
      (Array.isArray(candidate.calibrationReferenceQuaternion) &&
        candidate.calibrationReferenceQuaternion.length === 4 &&
        candidate.calibrationReferenceQuaternion.every(
          (component) => typeof component === "number" && Number.isFinite(component),
        ))) &&
    (candidate.slashCount === undefined ||
      (Number.isSafeInteger(candidate.slashCount) && (candidate.slashCount as number) >= 0)) &&
    (candidate.blocking === undefined || typeof candidate.blocking === "boolean") &&
    typeof candidate.calibrated === "boolean" &&
    (candidate.source === undefined ||
      candidate.source === "phone" ||
      candidate.source === "simulation")
  );
}

/**
 * Admits monotonically increasing samples within one phone session and
 * accepts sequence zero when a newer session generation appears. Samples
 * from an older session are rejected even if their sequence is large.
 */
export class SessionSequenceAdmission {
  private activeGeneration: number | null = null;
  private lastAcceptedSequence = -1;

  get generation(): number | null {
    return this.activeGeneration;
  }

  get lastSequence(): number | null {
    return this.lastAcceptedSequence >= 0 ? this.lastAcceptedSequence : null;
  }

  begin(generation: number | null): void {
    this.activeGeneration = generation;
    this.lastAcceptedSequence = -1;
  }

  accept(generation: number, sequence: number): boolean {
    if (
      !Number.isInteger(generation) ||
      generation <= 0 ||
      !Number.isInteger(sequence) ||
      sequence < 0
    ) {
      return false;
    }

    if (this.activeGeneration === null || generation > this.activeGeneration) {
      this.activeGeneration = generation;
      this.lastAcceptedSequence = -1;
    }

    if (
      generation !== this.activeGeneration ||
      sequence <= this.lastAcceptedSequence
    ) {
      return false;
    }

    this.lastAcceptedSequence = sequence;
    return true;
  }

  reset(): void {
    this.activeGeneration = null;
    this.lastAcceptedSequence = -1;
  }
}

export function normalizeRoomCode(value: string | null | undefined): string {
  const room = (value ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(room) ? room : "";
}

export function createRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function createInitialRelayStatus(role: RelayRole, room: string): RelayStatus {
  return {
    role,
    room,
    connection: "idle",
    peerConnected: false,
    streamState: "idle",
    samplesPerSecond: 0,
    sessionGeneration: null,
    lastSequence: null,
    sampleAgeMs: null,
    calibrated: false,
    quaternion: null,
    rawQuaternion: null,
    calibrationReferenceQuaternion: null,
    relayRttMs: null,
    outOfOrderSamples: 0,
    error: null,
  };
}
