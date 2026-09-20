import type { QuaternionTuple } from "../input/MotionTypes";

export const PRIMARY_GRIP_MESSAGE_TYPE = "primary-grip" as const;

/** Primary grip pose in the publishing fighter root's local coordinate frame. */
export type PrimaryGripNetworkPose = {
  type: typeof PRIMARY_GRIP_MESSAGE_TYPE;
  position: [number, number, number];
  rotation: QuaternionTuple;
  sessionGeneration: number;
  sequence: number;
};

function finiteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) &&
    value.length === length &&
    value.every((component) => typeof component === "number" && Number.isFinite(component));
}

export function isPrimaryGripNetworkPose(value: unknown): value is PrimaryGripNetworkPose {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== PRIMARY_GRIP_MESSAGE_TYPE ||
    !finiteTuple(candidate.position, 3) ||
    !finiteTuple(candidate.rotation, 4) ||
    !Number.isSafeInteger(candidate.sessionGeneration) ||
    (candidate.sessionGeneration as number) < 0 ||
    !Number.isSafeInteger(candidate.sequence) ||
    (candidate.sequence as number) < 0
  ) {
    return false;
  }
  const rotation = candidate.rotation as number[];
  return Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3]) > 1e-6;
}

export function clonePrimaryGripNetworkPose(pose: PrimaryGripNetworkPose): PrimaryGripNetworkPose {
  return {
    ...pose,
    position: [...pose.position] as [number, number, number],
    rotation: [...pose.rotation] as QuaternionTuple,
  };
}

/** Rejects duplicated, out-of-order, and previous-session network poses. */
export class PrimaryGripSequenceAdmission {
  private generation = -1;
  private sequence = -1;

  accept(pose: PrimaryGripNetworkPose): boolean {
    if (!isPrimaryGripNetworkPose(pose) || pose.sessionGeneration < this.generation) return false;
    if (pose.sessionGeneration > this.generation) {
      this.generation = pose.sessionGeneration;
      this.sequence = -1;
    }
    if (pose.sequence <= this.sequence) return false;
    this.sequence = pose.sequence;
    return true;
  }

  reset(): void {
    this.generation = -1;
    this.sequence = -1;
  }
}
