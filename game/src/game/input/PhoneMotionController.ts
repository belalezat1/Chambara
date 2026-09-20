import { SwingDetector } from "./CircleSword";
import { Quaternion } from "@babylonjs/core";

import {
  deviceOrientationToQuaternion,
  getScreenOrientationAngle,
  quaternionToTuple,
  relativeOrientation,
} from "./MotionMath";
import { MotionRelayClient } from "./MotionRelayClient";
import { normalizeRoomCode, type QuaternionTuple, type RelayStatus } from "./MotionTypes";
import { SENSOR_SEND_INTERVAL_MS } from "./SendRate";

type SensorState = "idle" | "requesting" | "waiting" | "active" | "error";
type PermissionSensor = {
  requestPermission?: () => Promise<string>;
};

export interface PhoneControllerStatus {
  room: string;
  connection: RelayStatus["connection"];
  peerConnected: boolean;
  relayRttMs: number | null;
  sensorState: SensorState;
  sensorMessage: string;
  secureContext: boolean;
  orientationSeen: boolean;
  motionSeen: boolean;
  calibrated: boolean;
  ready: boolean;
  sentPerSecond: number;
  blocking: boolean;
  lastQuaternion: QuaternionTuple | null;
  rawQuaternion: QuaternionTuple | null;
  calibrationReferenceQuaternion: QuaternionTuple | null;
  angles: [number, number, number] | null;
}

type StatusListener = (status: PhoneControllerStatus) => void;

const SENSOR_GAP_MS = 2_000;

export function createInitialPhoneControllerStatus(room: string): PhoneControllerStatus {
  return {
    room,
    connection: "idle",
    peerConnected: false,
    relayRttMs: null,
    sensorState: "idle",
    sensorMessage:
      "Hold the phone flat with the screen up and top edge toward the monitor, then recenter.",
    secureContext: window.isSecureContext,
    orientationSeen: false,
    motionSeen: false,
    calibrated: false,
    ready: false,
    sentPerSecond: 0,
    blocking: false,
    lastQuaternion: null,
    rawQuaternion: null,
    calibrationReferenceQuaternion: null,
    angles: null,
  };
}

export class PhoneMotionController {
  private readonly room: string;
  private readonly statusListener: StatusListener;
  private readonly relay: MotionRelayClient;
  private readonly status: PhoneControllerStatus;

  private active = false;
  private sendTimer: number | null = null;
  private noReadingTimer: number | null = null;
  private sentWindowStarted = performance.now();
  private sentWindowCount = 0;
  private lastOrientationAt: number | null = null;
  private rawQuaternion: Quaternion | null = null;
  private calibrationReference: Quaternion | null = null;
  private sequence = 0;
  private slashCount = 0;
  private blocking = false;
  private lastSentCalibrationKey: string | null = null;
  private readonly swingDetector = new SwingDetector();
  private wakeLock: { release: () => Promise<void> } | null = null;

  constructor(room: string, statusListener: StatusListener) {
    this.room = normalizeRoomCode(room);
    this.statusListener = statusListener;
    this.status = createInitialPhoneControllerStatus(this.room);
    this.relay = new MotionRelayClient(
      "phone",
      this.room,
      (relayStatus) => this.applyRelayStatus(relayStatus),
    );
  }

  start(): void {
    if (!this.room) {
      this.status.sensorState = "error";
      this.status.sensorMessage = "Enter a valid six-character room code to connect.";
      this.emitStatus();
      return;
    }
    this.relay.start();
    this.emitStatus();
  }

  async enableMotion(): Promise<boolean> {
    if (this.active) return true;
    if (!window.isSecureContext) {
      this.status.sensorState = "error";
      this.status.sensorMessage =
        "Motion requires HTTPS. Open the controller through the secure desktop/tunnel URL.";
      this.emitStatus();
      return false;
    }

    this.status.sensorState = "requesting";
    this.status.sensorMessage = "Requesting motion permission…";
    this.emitStatus();

    try {
      const constructors = [
        window.DeviceOrientationEvent,
        window.DeviceMotionEvent,
      ].filter(Boolean) as unknown as PermissionSensor[];
      // The request calls happen before the first await so iOS-style prompts
      // remain inside the button's user-gesture activation.
      const results = await Promise.all(
        constructors.map((constructor) =>
          typeof constructor.requestPermission === "function"
            ? constructor.requestPermission()
            : Promise.resolve("granted"),
        ),
      );
      if (results.some((result) => result === "denied")) {
        this.status.sensorState = "error";
        this.status.sensorMessage =
          "Motion permission was denied. Allow motion access in browser settings and reload.";
        this.emitStatus();
        return false;
      }
      if (!window.DeviceOrientationEvent) {
        this.status.sensorState = "error";
        this.status.sensorMessage = "This browser does not expose DeviceOrientation.";
        this.emitStatus();
        return false;
      }

      this.active = true;
      window.addEventListener("deviceorientation", this.handleOrientation);
      window.addEventListener("devicemotion", this.handleMotion);
      document.addEventListener("visibilitychange", this.handleVisibility);
      this.sendTimer = window.setInterval(
        () => this.publishLatestOrientation(),
        SENSOR_SEND_INTERVAL_MS,
      );
      this.noReadingTimer = window.setInterval(
        () => this.updateSensorHealth(),
        1_000,
      );
      void this.requestWakeLock();
      this.status.sensorState = "waiting";
      this.status.sensorMessage =
        "Waiting for orientation… hold flat, screen up, top edge toward the monitor, and keep this tab visible.";
      this.emitStatus();
      return true;
    } catch (error) {
      this.status.sensorState = "error";
      this.status.sensorMessage =
        "Could not start motion sensors: " +
        (error instanceof Error ? error.message : String(error));
      this.emitStatus();
      return false;
    }
  }

  setSwingThreshold(value: number): void {
    if (Number.isFinite(value)) this.swingDetector.threshold = Math.max(5, Math.min(25, value));
  }

  setBlocking(blocking: boolean): void {
    const next = Boolean(blocking);
    if (this.blocking === next) return;
    this.blocking = next;
    this.status.blocking = next;
    if (next) this.swingDetector.reset();
    this.publishLatestOrientation();
    this.emitStatus();
  }

  setReady(ready: boolean): boolean {
    if (ready && (!this.status.peerConnected || !this.status.calibrated)) {
      return false;
    }
    const next = Boolean(ready);
    if (this.status.ready === next) return next;
    this.status.ready = next;
    this.relay.setReady(next);
    this.status.sensorMessage = next
      ? "Ready. Keep this controller tab visible for the match."
      : "Not ready. Recenter if you need to recalibrate before readying up.";
    this.emitStatus();
    return next;
  }

  recenter(): boolean {
    if (!this.rawQuaternion) {
      this.status.sensorMessage =
        "Waiting for orientation data before recentering.";
      this.emitStatus();
      return false;
    }
    this.swingDetector.reset();
    this.calibrationReference = this.rawQuaternion.clone();
    this.lastSentCalibrationKey = null;
    this.setReady(false);
    this.status.calibrated = true;
    this.status.calibrationReferenceQuaternion = quaternionToTuple(
      this.calibrationReference,
    );
    this.status.sensorMessage =
      "Recentered. Move the phone's top edge up, down, left, right, or roll around it.";
    this.publishLatestOrientation();
    this.emitStatus();
    return true;
  }

  stop(): void {
    this.active = false;
    this.blocking = false;
    this.status.ready = false;
    this.status.blocking = false;
    this.lastSentCalibrationKey = null;
    this.swingDetector.reset();
    if (this.sendTimer !== null) window.clearInterval(this.sendTimer);
    if (this.noReadingTimer !== null) window.clearInterval(this.noReadingTimer);
    this.sendTimer = null;
    this.noReadingTimer = null;
    window.removeEventListener("deviceorientation", this.handleOrientation);
    window.removeEventListener("devicemotion", this.handleMotion);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.relay.stop();
  }

  private readonly handleOrientation = (event: DeviceOrientationEvent): void => {
    const values = [event.alpha, event.beta, event.gamma];
    if (!values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return;
    }
    const angles = values as [number, number, number];
    this.status.angles = angles;
    this.rawQuaternion = deviceOrientationToQuaternion(
      angles[0],
      angles[1],
      angles[2],
      getScreenOrientationAngle(),
    );
    this.status.orientationSeen = true;
    this.lastOrientationAt = performance.now();
    if (this.status.sensorState === "waiting") {
      this.status.sensorState = "active";
      this.status.sensorMessage = this.status.calibrated
        ? "Orientation active."
        : "Orientation active. Hold neutral and tap Recenter.";
    }
  };

  private readonly handleMotion = (event: DeviceMotionEvent): void => {
    const acceleration = event.acceleration;
    if (
      acceleration &&
      [acceleration.x, acceleration.y, acceleration.z].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    ) {
      this.status.motionSeen = true;
      if (
        !this.blocking &&
        !document.hidden &&
        this.status.calibrated &&
        this.status.peerConnected &&
        this.lastOrientationAt !== null &&
        performance.now() - this.lastOrientationAt < 250 &&
        this.swingDetector.sample(
          Math.hypot(acceleration.x!, acceleration.y!, acceleration.z!),
          performance.now(),
        )
      ) {
        this.slashCount += 1;
        this.publishLatestOrientation();
      }
    }
  };

  private readonly handleVisibility = (): void => {
    this.swingDetector.reset();
    if (!document.hidden && this.active) {
      this.status.sensorMessage =
        "Controller tab resumed. Recenter if the phone was moved while hidden.";
      this.emitStatus();
    }
  };

  private publishLatestOrientation(): void {
    if (!this.active || !this.rawQuaternion) return;

    const relative = this.status.calibrated && this.calibrationReference
      ? relativeOrientation(this.calibrationReference, this.rawQuaternion)
      : this.rawQuaternion.clone().normalize();
    // Preserve the complete calibrated quaternion. The physical screen-up
    // convention no longer needs the old sideways-grip pitch inversion.
    const tuple = quaternionToTuple(relative);
    const rawTuple = quaternionToTuple(this.rawQuaternion);
    const referenceTuple = this.calibrationReference
      ? quaternionToTuple(this.calibrationReference)
      : null;
    const calibrationKey = referenceTuple ? referenceTuple.join(",") : null;
    const includeCalibration =
      referenceTuple !== null && calibrationKey !== this.lastSentCalibrationKey;
    const payload: Record<string, unknown> = {
      type: "sample",
      slashCount: this.slashCount,
      blocking: this.blocking,
      sequence: this.sequence,
      timestamp: Date.now(),
      quaternion: tuple,
      calibrated: this.status.calibrated,
      source: "phone",
    };
    // Only attach heavy debug/calibration fields when they change — keeps
    // 60 Hz frames small so the relay is less likely to drop under load.
    if (includeCalibration) {
      payload.calibrationReferenceQuaternion = referenceTuple;
      payload.rawQuaternion = rawTuple;
    }
    const sent = this.relay.send(payload);
    if (!sent) return;

    if (includeCalibration) this.lastSentCalibrationKey = calibrationKey;
    this.sequence += 1;
    this.sentWindowCount += 1;
    this.status.lastQuaternion = tuple;
    this.status.rawQuaternion = rawTuple;
    this.status.calibrationReferenceQuaternion = referenceTuple;
  }

  private updateSensorHealth(): void {
    const now = performance.now();
    if (this.active && this.lastOrientationAt !== null && now - this.lastOrientationAt > SENSOR_GAP_MS) {
      this.status.sensorState = "waiting";
      this.status.sensorMessage =
        "Sensor stream paused. Keep this page in the foreground.";
    }
    const elapsed = now - this.sentWindowStarted;
    if (elapsed >= 1_000) {
      this.status.sentPerSecond = Math.round((this.sentWindowCount * 1_000) / elapsed);
      this.sentWindowCount = 0;
      this.sentWindowStarted = now;
    }
    this.emitStatus();
  }

  private applyRelayStatus(relayStatus: RelayStatus): void {
    this.status.connection = relayStatus.connection;
    this.status.peerConnected = relayStatus.peerConnected;
    this.status.relayRttMs = relayStatus.relayRttMs;
    if (!relayStatus.peerConnected && this.status.ready) {
      this.status.ready = false;
    }
    this.emitStatus();
  }

  private async requestWakeLock(): Promise<void> {
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: {
          request: (type: "screen") => Promise<{ release: () => Promise<void> }>;
        };
      }
    ).wakeLock;
    if (!wakeLock) return;
    try {
      this.wakeLock = await wakeLock.request("screen");
    } catch {
      // Wake Lock is optional; sensor control still works without it.
    }
  }

  private emitStatus(): void {
    this.statusListener({
      ...this.status,
      angles: this.status.angles ? ([...this.status.angles] as [number, number, number]) : null,
      lastQuaternion: this.status.lastQuaternion
        ? ([...this.status.lastQuaternion] as QuaternionTuple)
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
