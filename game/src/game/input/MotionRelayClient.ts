import {
  createInitialRelayStatus,
  isControllerSample,
  SessionSequenceAdmission,
  type ControllerSample,
  type QuaternionTuple,
  type RelayRole,
  type RelayStatus,
} from "./MotionTypes";

type RelayStatusListener = (status: RelayStatus) => void;
type RelaySampleListener = (sample: ControllerSample) => void;

const RELAY_PATH = "/motion-ws";
const MAX_BUFFERED_AMOUNT = 16_384;
const STATUS_INTERVAL_MS = 250;
const RECONNECT_DELAY_MS = 1_500;

export class MotionRelayClient {
  private readonly role: RelayRole;
  private readonly room: string;
  private readonly statusListener: RelayStatusListener;
  private readonly sampleListener?: RelaySampleListener;
  private readonly status: RelayStatus;
  private readonly sequenceAdmission = new SessionSequenceAdmission();

  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private statusTimer: number | null = null;
  private pingTimer: number | null = null;
  private stopped = true;
  private lastSampleAt: number | null = null;
  private rateWindowStarted = performance.now();
  private rateWindowCount = 0;

  constructor(
    role: RelayRole,
    room: string,
    statusListener: RelayStatusListener,
    sampleListener?: RelaySampleListener,
  ) {
    this.role = role;
    this.room = room;
    this.statusListener = statusListener;
    this.sampleListener = sampleListener;
    this.status = createInitialRelayStatus(role, room);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.status.connection = "connecting";
    this.emitStatus();
    this.statusTimer = window.setInterval(() => this.emitStatus(), STATUS_INTERVAL_MS);
    this.pingTimer = window.setInterval(() => {
      this.send({ type: "ping", time: performance.now() });
    }, 2_000);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.statusTimer !== null) window.clearInterval(this.statusTimer);
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.reconnectTimer = null;
    this.statusTimer = null;
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.close(1000, "Client stopped");
    this.status.connection = "idle";
    this.status.peerConnected = false;
    this.status.streamState = "idle";
    this.status.sessionGeneration = null;
    this.status.rawQuaternion = null;
    this.status.calibrationReferenceQuaternion = null;
    this.sequenceAdmission.reset();
    this.emitStatus();
  }

  send(message: object): boolean {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      this.socket.bufferedAmount >= MAX_BUFFERED_AMOUNT
    ) {
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private connect(): void {
    if (this.stopped) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url =
      protocol +
      "//" +
      window.location.host +
      RELAY_PATH +
      "?room=" +
      encodeURIComponent(this.room) +
      "&role=" +
      this.role;

    this.status.connection = "connecting";
    this.status.error = null;
    this.emitStatus();

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.handleConnectionError(error);
      return;
    }

    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.stopped) return;
      this.status.connection = "connected";
      this.status.error = null;
      this.emitStatus();
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || this.stopped) return;
      this.handleMessage(event.data);
    });
    socket.addEventListener("error", () => {
      if (this.socket !== socket || this.stopped) return;
      this.handleConnectionError(new Error("WebSocket connection error"));
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.status.peerConnected = false;
      this.status.connection = "disconnected";
      this.status.streamState = "idle";
      if (event.code === 4000) {
        this.status.connection = "error";
        this.status.error = "Another tab replaced this room role.";
      }
      this.emitStatus();
      if (!this.stopped && event.code !== 4000) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, RECONNECT_DELAY_MS);
      }
    });
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== "object") return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    if (message.type === "peers") {
      const peer =
        this.role === "host"
          ? message.phone === true
          : message.host === true;
      const advertisedGeneration =
        typeof message.sessionGeneration === "number" &&
        Number.isInteger(message.sessionGeneration) &&
        message.sessionGeneration > 0
          ? message.sessionGeneration
          : null;

      if (this.role === "host" && peer && advertisedGeneration !== null &&
        advertisedGeneration !== this.status.sessionGeneration) {
        this.sequenceAdmission.begin(advertisedGeneration);
        this.lastSampleAt = null;
        this.status.lastSequence = null;
        this.status.sampleAgeMs = null;
        this.status.calibrated = false;
        this.status.quaternion = null;
        this.status.rawQuaternion = null;
        this.status.calibrationReferenceQuaternion = null;
        this.rateWindowCount = 0;
        this.rateWindowStarted = performance.now();
      }
      if (this.role === "host" && !peer) {
        this.lastSampleAt = null;
        this.status.lastSequence = null;
        this.status.sampleAgeMs = null;
        this.status.calibrated = false;
        this.status.quaternion = null;
        this.status.rawQuaternion = null;
        this.status.calibrationReferenceQuaternion = null;
        this.rateWindowCount = 0;
        this.rateWindowStarted = performance.now();
      }
      this.status.peerConnected = peer;
      this.status.sessionGeneration = advertisedGeneration;
      this.status.connection = peer ? "connected" : "waiting";
      this.emitStatus();
      return;
    }

    if (message.type === "pong" && typeof message.time === "number") {
      this.status.relayRttMs = Math.max(0, Math.round(performance.now() - message.time));
      return;
    }

    if (this.role !== "host" || message.type !== "sample" || !isControllerSample(message)) {
      return;
    }

    if (!this.status.peerConnected || this.status.sessionGeneration === null) {
      return;
    }

    const sequence = message.sequence;
    const sessionGeneration = message.sessionGeneration;
    if (!this.sequenceAdmission.accept(sessionGeneration, sequence)) {
      this.status.outOfOrderSamples += 1;
      return;
    }

    const quaternion = message.quaternion as QuaternionTuple;
    const sample: ControllerSample = {
      sessionGeneration,
      sequence,
      timestamp: message.timestamp,
      quaternion,
      rawQuaternion: message.rawQuaternion
        ? ([...(message.rawQuaternion as QuaternionTuple)] as QuaternionTuple)
        : undefined,
      calibrationReferenceQuaternion: message.calibrationReferenceQuaternion
        ? ([...(message.calibrationReferenceQuaternion as QuaternionTuple)] as QuaternionTuple)
        : undefined,
      calibrated: message.calibrated,
      source: "phone",
      slashCount: message.slashCount,
      blocking: message.blocking === true,
    };
    this.status.lastSequence = sample.sequence;
    this.status.sessionGeneration = sample.sessionGeneration;
    this.status.sampleAgeMs = 0;
    this.status.calibrated = sample.calibrated;
    this.status.quaternion = [...sample.quaternion] as QuaternionTuple;
    this.status.rawQuaternion = message.rawQuaternion
      ? ([...(message.rawQuaternion as QuaternionTuple)] as QuaternionTuple)
      : null;
    this.status.calibrationReferenceQuaternion = message.calibrationReferenceQuaternion
      ? ([...(message.calibrationReferenceQuaternion as QuaternionTuple)] as QuaternionTuple)
      : null;
    this.lastSampleAt = performance.now();
    this.rateWindowCount += 1;
    this.sampleListener?.(sample);
  }

  private handleConnectionError(error: unknown): void {
    this.status.connection = "error";
    this.status.error = error instanceof Error ? error.message : String(error);
    this.emitStatus();
  }

  private emitStatus(): void {
    const now = performance.now();
    if (this.lastSampleAt === null || !this.status.peerConnected) {
      this.status.sampleAgeMs = null;
      this.status.streamState = "idle";
    } else {
      this.status.sampleAgeMs = Math.max(0, Math.round(now - this.lastSampleAt));
      this.status.streamState = this.status.sampleAgeMs > 1_000 ? "stale" : "live";
    }

    const elapsed = now - this.rateWindowStarted;
    if (elapsed >= 1_000) {
      this.status.samplesPerSecond = Math.round((this.rateWindowCount * 1_000) / elapsed);
      this.rateWindowCount = 0;
      this.rateWindowStarted = now;
    }

    this.statusListener({
      ...this.status,
      quaternion: this.status.quaternion
        ? ([...this.status.quaternion] as QuaternionTuple)
        : null,
      rawQuaternion: this.status.rawQuaternion
        ? ([...this.status.rawQuaternion] as QuaternionTuple)
        : null,
      calibrationReferenceQuaternion: this.status.calibrationReferenceQuaternion
        ? ([...this.status.calibrationReferenceQuaternion] as QuaternionTuple)
        : null,
    });
  }
}
