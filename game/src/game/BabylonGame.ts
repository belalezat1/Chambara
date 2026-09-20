import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Rendering/outlineRenderer";

import {
  AbstractMesh,
  ArcRotateCamera,
  BoneIKController,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Material,
  Matrix,
  MeshBuilder,
  MultiMaterial,
  Quaternion,
  Scene,
  SceneLoader,
  Space,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { Bone, LinesMesh, Observer, Skeleton } from "@babylonjs/core";

import {
  approachBlockBlend,
  blockGuardPoseOffsets,
  BLOCK_AIM_Y,
  blockBladeDirection,
  lerpGuardOffsets,
  nlerpBladeDirection,
} from "./input/BlockGuard";
import {
  CircleSword,
  circleDirectionWeights,
  CUT_SECONDS,
  guardPoseOffsets,
  type CirclePoint,
  type SwordPhase,
} from "./input/CircleSword";
import { AnimationController, type AnimationPlayOptions } from "./animation/AnimationController";
import {
  ARENA_RADIUS,
  BLOCK_ATTACKER_STUN_SECONDS,
  HIT_INVULN_MS,
  SEAT_HALF_SPACING,
  STUN_SECONDS,
  type CombatOutcomeKind,
  type MatchPhase,
} from "./combat/CombatConstants";
import { bladeHitsBody } from "./combat/CombatCollision";
import {
  faceYawRadians,
  lungeFactorFromSlashProgress,
  lungeTargetX,
  regroupTargets,
  stepLungeRecover,
  stepRegroup,
  type RootPair,
} from "./combat/CombatFootwork";
import { MatchPhaseMachine, type MatchPhaseHud } from "./combat/MatchPhaseMachine";
import { isInHitWindow, resolveCombat, type FighterSnapshot } from "./combat/CombatResolver";
import { estimateRemoteBladePose, pickAttackerBladePose } from "./combat/CombatRemoteBlade";
import { advanceSlashArming } from "./combat/CombatSlashArming";
import type { CombatIntentPublish, CombatOutcomeEvent, RemoteCombatIntent } from "./net/SpacetimeMatchClient";
import { clampTwoBoneTarget } from "./input/ArmPoseMath";
import {
  composeTorsoFollowRotation,
  quaternionAngularDistance,
} from "./input/TorsoFollowMath";
import {
  derivePhoneToGameplayBasis,
  GAMEPLAY_BLADE_FORWARD_AXIS,
  neutralSwordRotation,
  phoneDeltaToGameDelta,
  PHONE_TO_GAME_BASIS,
  quaternionToTuple,
  SIMULATED_POSE_NAMES,
  simulatedOrientation,
  simulatedPhonePose,
  tupleToQuaternion,
  type SimulatedPoseName,
} from "./input/MotionMath";
import type {
  ControllerSample,
  QuaternionTuple,
  RelayStatus,
} from "./input/MotionTypes";
import { SessionSequenceAdmission } from "./input/MotionTypes";
import {
  clonePrimaryGripNetworkPose,
  isPrimaryGripNetworkPose,
  PrimaryGripSequenceAdmission,
  type PrimaryGripNetworkPose,
} from "./net/PrimaryGripProtocol";
import {
  deriveWeaponFrame,
  deriveActualHandContact,
  deriveWeaponGeometry,
  deriveWeaponPosePoints,
  deriveWristTargetFromGrip,
  solveSphericalShellPosition,
  transformWeaponGeometryToGameplay,
  type WeaponTargetSnapshot,
  type WeaponGeometry,
  type WeaponFrame,
  weaponFrameCorrection,
  WeaponTarget,
} from "./input/WeaponTarget";

export const SIM_DT = 1 / 60;
export const MOTION_STALE_MS = 1_000;
export const MOTION_SMOOTHING_ALPHA = 0.28;
export const EXPECTED_ANIMATIONS = [
  "CombatIdle",
  "AttackSwing",
  "AttackVertical",
  "AttackDiagonalLeft",
  "AttackDiagonalRight",
  "AttackJab",
  "BlockIdle",
  "BlockSideLeft",
  "BlockSideRight",
  "BlockedStun",
  "HitKnockback",
  "AdvanceAfterHit",
  "Defeat",
] as const;

export const WEAPON_NODE_NAMES = [
  "WeaponRoot",
  "ReachCenter",
  "GripPrimary",
  "GripSecondary",
  "BladeBase",
  "BladeTip",
  "BladeUp",
  "Shinai",
  "hand.R",
  "hand.L",
] as const;

export const POSE_STATES = [
  "READY",
  "BLOCK",
  "ATTACK_WINDUP",
  "ATTACK_ACTIVE",
  "ATTACK_RECOVERY",
  "REACTION",
] as const;

export type PoseState = (typeof POSE_STATES)[number];

export const POSE_REACH_FRACTIONS: Record<PoseState, number> = {
  READY: 0.82,
  BLOCK: 0.65,
  ATTACK_WINDUP: 0.78,
  ATTACK_ACTIVE: 0.92,
  ATTACK_RECOVERY: 0.82,
  REACTION: 0.65,
};

export const SIMULATED_POSES = SIMULATED_POSE_NAMES;

export type AssetState = "loading" | "ready" | "error";
export type MotionSource = "none" | "phone" | "simulation";
export type MotionStreamState = "idle" | "waiting" | "live" | "stale";
export type ShoulderAnchorSource = "manifest" | "rest-capture" | "unavailable";

export interface MotionRuntimeStatus {
  swordPhase: SwordPhase;
  guardX: number;
  guardY: number;
  /** Latest phone hold-to-block flag from the controller sample. */
  blocking: boolean;
  connection: RelayStatus["connection"];
  room: string;
  peerConnected: boolean;
  streamState: MotionStreamState;
  source: MotionSource;
  samplesPerSecond: number;
  sessionGeneration: number | null;
  lastSequence: number | null;
  sampleAgeMs: number | null;
  calibrated: boolean;
  quaternion: QuaternionTuple | null;
  rawDeviceQuaternion: QuaternionTuple | null;
  calibrationReferenceQuaternion: QuaternionTuple | null;
  relativeQuaternion: QuaternionTuple | null;
  mappedGameQuaternion: QuaternionTuple | null;
  phoneToGameplayBasisQuaternion: QuaternionTuple | null;
  neutralWeaponQuaternion: QuaternionTuple | null;
  visibleNeutralWeaponQuaternion: QuaternionTuple | null;
  gameplayWeaponQuaternion: QuaternionTuple | null;
  weaponQuaternion: QuaternionTuple | null;
  weaponTargetSource: "none" | "controller";
  weaponTargetRootAnchor: [number, number, number] | null;
  weaponTargetPosition: [number, number, number] | null;
  weaponTargetQuaternion: QuaternionTuple | null;
  weaponTargetBase: [number, number, number] | null;
  weaponTargetTip: [number, number, number] | null;
  poseState: PoseState;
  targetPoseState: PoseState;
  reachFraction: number;
  reachShellRadiusMeters: number | null;
  reachCenterRootLocal: [number, number, number] | null;
  reachCenterWorld: [number, number, number] | null;
  weaponGeometryGripSpacingMeters: number | null;
  weaponGeometryBladeLengthMeters: number | null;
  twoArmFeasible: boolean;
  reachAdjusted: boolean;
  rightArmMaxReachMeters: number | null;
  leftArmMaxReachMeters: number | null;
  primaryHandTarget: [number, number, number] | null;
  secondaryHandTarget: [number, number, number] | null;
  rightElbowPole: [number, number, number] | null;
  leftElbowPole: [number, number, number] | null;
  gameplaySwordForward: [number, number, number] | null;
  gameplaySwordUp: [number, number, number] | null;
  visibleShinaiForward: [number, number, number] | null;
  gameplayVisibleForwardDot: number | null;
  bladeForwardInPrimaryFrame: [number, number, number] | null;
  bladeUpInPrimaryFrame: [number, number, number] | null;
  bladeRightInPrimaryFrame: [number, number, number] | null;
  assetFrameCorrectionQuaternion: QuaternionTuple | null;
  swordForward: [number, number, number] | null;
  primaryGripSource: string;
  secondaryGripSource: string;
  weaponMarkersStable: boolean;
  rightHandContact: [number, number, number] | null;
  leftHandContact: [number, number, number] | null;
  rightGripErrorMeters: number | null;
  leftGripErrorMeters: number | null;
  gripErrorThresholdMeters: number;
  rightHandContactLocalMeters: number | null;
  leftHandContactLocalMeters: number | null;
  rightShoulderRestRoot: [number, number, number] | null;
  leftShoulderRestRoot: [number, number, number] | null;
  rightShoulderRestCaptureRoot: [number, number, number] | null;
  leftShoulderRestCaptureRoot: [number, number, number] | null;
  rightShoulderAnchorErrorMeters: number | null;
  leftShoulderAnchorErrorMeters: number | null;
  shoulderAnchorSource: ShoulderAnchorSource;
  torsoFollowEnabled: boolean;
  torsoFollowYawRadians: number | null;
  torsoFollowPitchRadians: number | null;
  torsoFollowDeltaRadians: number | null;
  torsoFollowDriftRadians: number | null;
  weaponTargetSessionGeneration: number | null;
  weaponTargetSequence: number | null;
  relayRttMs: number | null;
  outOfOrderSamples: number;
  weaponControlEnabled: boolean;
  controlNode: string;
  ikClamped: boolean;
  rightIkClamped: boolean;
  leftIkClamped: boolean;
  ikFinite: boolean;
  showWeaponDebug: boolean;
  showIkDebug: boolean;
  smoothingEnabled: boolean;
  smoothingAlpha: number;
}

export interface RuntimeStatus {
  fps: number;
  simRate: number;
  simulationTicks: number;
  dojo: AssetState;
  v05Manifest: AssetState;
  player: AssetState;
  dummy: AssetState;
  currentPlayerAnimation: string;
  currentDummyAnimation: string;
  discoveredAnimations: string[];
  missingAnimations: string[];
  weaponNodes: Record<string, boolean>;
  errors: string[];
  cameraMode: "follow" | "debug";
  motion: MotionRuntimeStatus;
}

export function createInitialRuntimeStatus(): RuntimeStatus {
  return {
    fps: 0,
    simRate: 60,
    simulationTicks: 0,
    dojo: "loading",
    v05Manifest: "loading",
    player: "loading",
    dummy: "loading",
    currentPlayerAnimation: "Loading",
    currentDummyAnimation: "Loading",
    discoveredAnimations: [],
    missingAnimations: [],
    weaponNodes: Object.fromEntries(WEAPON_NODE_NAMES.map((name) => [name, false])),
    errors: [],
    cameraMode: "follow",
    motion: {
      swordPhase: "aiming",
      guardX: 0,
      guardY: 0,
      blocking: false,
      connection: "idle",
      room: "",
      peerConnected: false,
      streamState: "idle",
      source: "none",
      samplesPerSecond: 0,
      sessionGeneration: null,
      lastSequence: null,
      sampleAgeMs: null,
      calibrated: false,
      quaternion: null,
      rawDeviceQuaternion: null,
      calibrationReferenceQuaternion: null,
      relativeQuaternion: null,
      mappedGameQuaternion: null,
      phoneToGameplayBasisQuaternion: null,
      neutralWeaponQuaternion: null,
      visibleNeutralWeaponQuaternion: null,
      gameplayWeaponQuaternion: null,
      weaponQuaternion: null,
      weaponTargetSource: "none",
      weaponTargetRootAnchor: null,
      weaponTargetPosition: null,
      weaponTargetQuaternion: null,
      weaponTargetBase: null,
      weaponTargetTip: null,
      poseState: "READY",
      targetPoseState: "READY",
      reachFraction: POSE_REACH_FRACTIONS.READY,
      reachShellRadiusMeters: null,
      reachCenterRootLocal: null,
      reachCenterWorld: null,
      weaponGeometryGripSpacingMeters: null,
      weaponGeometryBladeLengthMeters: null,
      twoArmFeasible: false,
      reachAdjusted: false,
      rightArmMaxReachMeters: null,
      leftArmMaxReachMeters: null,
      primaryHandTarget: null,
      secondaryHandTarget: null,
      rightElbowPole: null,
      leftElbowPole: null,
      gameplaySwordForward: null,
      gameplaySwordUp: null,
      visibleShinaiForward: null,
      gameplayVisibleForwardDot: null,
      bladeForwardInPrimaryFrame: null,
      bladeUpInPrimaryFrame: null,
      bladeRightInPrimaryFrame: null,
      assetFrameCorrectionQuaternion: null,
      swordForward: null,
      primaryGripSource: "unavailable",
      secondaryGripSource: "unavailable",
      weaponMarkersStable: false,
      rightHandContact: null,
      leftHandContact: null,
      rightGripErrorMeters: null,
      leftGripErrorMeters: null,
      gripErrorThresholdMeters: GRIP_ERROR_THRESHOLD_METERS,
      rightHandContactLocalMeters: null,
      leftHandContactLocalMeters: null,
      rightShoulderRestRoot: null,
      leftShoulderRestRoot: null,
      rightShoulderRestCaptureRoot: null,
      leftShoulderRestCaptureRoot: null,
      rightShoulderAnchorErrorMeters: null,
      leftShoulderAnchorErrorMeters: null,
      shoulderAnchorSource: "unavailable",
      torsoFollowEnabled: false,
      torsoFollowYawRadians: null,
      torsoFollowPitchRadians: null,
      torsoFollowDeltaRadians: null,
      torsoFollowDriftRadians: null,
      weaponTargetSessionGeneration: null,
      weaponTargetSequence: null,
      relayRttMs: null,
      outOfOrderSamples: 0,
      weaponControlEnabled: false,
      controlNode: "unavailable",
      ikClamped: false,
      rightIkClamped: false,
      leftIkClamped: false,
      ikFinite: false,
      showWeaponDebug: false,
      showIkDebug: false,
      smoothingEnabled: false,
      smoothingAlpha: MOTION_SMOOTHING_ALPHA,
    },
  };
}

type StatusListener = (status: RuntimeStatus) => void;

function vectorTuple(value: Vector3): [number, number, number] {
  return [value.x, value.y, value.z];
}

/**
 * armMeasurements are authored in Blender's +Z-up, front=-Y root space.
 * glTF's runtime basis is [x, blender-z, -blender-y].
 */
function manifestRestPointToRuntimeRoot(point: readonly number[]): Vector3 {
  return new Vector3(point[0], point[2], -point[1]);
}

interface CharacterInstance {
  root: TransformNode;
  controller: AnimationController;
  importedMeshes: AbstractMesh[];
}

interface ArmRig {
  side: "right" | "left";
  shoulder: Bone;
  upperArm: Bone;
  forearm: Bone;
  hand: Bone;
  controller: BoneIKController;
  targetNode: TransformNode;
  poleNode: TransformNode;
  firstLength: number;
  secondLength: number;
  handRotationOffset: Quaternion;
  handContactLocal: Vector3;
  /** Rest-pose skeleton capture retained for manifest validation/debug. */
  restCaptureRoot: Vector3;
  /** Authoritative gameplay anchor; populated from the v05 manifest. */
  shoulderRestRoot: Vector3;
  /** Animation-driven transform nodes retained as presentation inputs. */
  animatedUpperArmNode: TransformNode | null;
  animatedForearmNode: TransformNode | null;
  animatedHandNode: TransformNode | null;
  origin: Vector3;
  target: Vector3;
  pole: Vector3;
  contact: Vector3;
  gripErrorMeters: number;
  clamped: boolean;
  finite: boolean;
}

interface V05HandContactManifest {
  bone: string;
  grip: string;
  localPosition: [number, number, number];
  rotationOffset: [number, number, number, number];
}

interface V05HandContactsManifest {
  right: V05HandContactManifest;
  left: V05HandContactManifest;
}

interface V05ShoulderRestManifest {
  right: Vector3;
  left: Vector3;
}

interface PoseRig {
  root: TransformNode;
  mesh: TransformNode;
  skeleton: Skeleton;
  spine: Bone | null;
  chest: Bone | null;
  rightArm: ArmRig | null;
  leftArm: ArmRig | null;
}

interface TorsoFollowBaseline {
  spine: Quaternion | null;
  chest: Quaternion | null;
  rightShoulder: Quaternion | null;
  leftShoulder: Quaternion | null;
}

interface WeaponAttachment {
  weaponRoot: TransformNode;
  shinai: TransformNode;
  primaryGrip: TransformNode;
  secondaryGrip: TransformNode;
  bladeBase: TransformNode;
  bladeTip: TransformNode;
  bladeUp: TransformNode;
  reachCenter: TransformNode;
  frame: WeaponFrame;
  geometry: WeaponGeometry;
  markersStable: boolean;
  primaryGripWorld: Vector3;
  secondaryGripWorld: Vector3;
  weaponRootToPrimary: Vector3;
  reachCenterRootLocal: Vector3;
}

const PLAYER_ASSET_PATH = "/assets/player/";
const PLAYER_ASSET_FILE = "Baizhong_Kendo_Animations_v07.glb";
const PLAYER_ASSET_MANIFEST_FILE = "Baizhong_Kendo_Animations_v07_manifest.json";
const DOJO_SCALE = 1.5;
const POLE_LATERAL_OFFSET = 0.42;
const POLE_FORWARD_OFFSET = 0.14;
const POLE_UP_OFFSET = 0.20;
const GRIP_ERROR_THRESHOLD_METERS = 0.03;
const REACH_SHELL_DAMPING = 12;
const SHELL_TRANSLATION_SWING = 0.40;
const TORSO_MAX_YAW = 0.48;
const TORSO_MAX_PITCH = 0.38;
/** Local seat used when publishing primary-grip world poses. */
const LOCAL_PLAYER_POSITION = new Vector3(-SEAT_HALF_SPACING, 0, 0);
const LOCAL_PLAYER_ROTATION_Y = Math.PI / 2;
/** Opponent seat that receives remapped remote primary-grip poses. */
const REMOTE_DUMMY_POSITION = new Vector3(SEAT_HALF_SPACING, 0, 0);
const REMOTE_DUMMY_ROTATION_Y = -Math.PI / 2;
const FOLLOW_CAMERA_HEIGHT = 1.62;
const FOLLOW_CAMERA_DISTANCE = 1.0;
const FOLLOW_CAMERA_STUN_DISTANCE = 1.55;
const FOLLOW_CAMERA_SIDE_OFFSET = 0.08;
const FOLLOW_CAMERA_LOOK_HEIGHT = 1.12;
const FOLLOW_CAMERA_LOOK_AHEAD = 1.35;
const FOLLOW_CAMERA_DAMPING = 10;
const LOCAL_UPPER_BODY_OPACITY = 0.03;
const LOCAL_LEG_OPACITY = 0.05;
const LOCAL_HAND_OPACITY = 1;
const LOCAL_STUN_BODY_OPACITY = 1;
const LOCAL_HAND_OUTLINE_WIDTH = 0.008;
const LOCAL_SWORD_OUTLINE_WIDTH = 0.006;

export class BabylonGame {
  readonly engine: Engine;
  readonly scene: Scene;

  private readonly camera: ArcRotateCamera;
  private readonly statusListener: StatusListener;
  private readonly status: RuntimeStatus = createInitialRuntimeStatus();
  private readonly canvas: HTMLCanvasElement;
  private readonly renderStep: () => void;
  private readonly neutralGripAnchor = new Vector3();
  private readonly reachCenterRootLocal = new Vector3();
  private readonly weaponTarget = new WeaponTarget();
  private circleSword = new CircleSword();
  private circleSession = "";
  private lastSlashCount = 0;
  private phoneBlocking = false;
  private matchCombatActive = false;
  private matchIsHost = false;
  private matchFrozen = false;
  private localIdentityHex: string | null = null;
  private remoteIdentityHex: string | null = null;
  private localSlashSeq = 0;
  private remoteIntent: RemoteCombatIntent | null = null;
  private remoteSlashStartedAt: number | null = null;
  private remoteSlashSeqSeen = 0;
  private remoteSlashAngle = Math.PI / 2;
  private playerOnSoftEdge = false;
  private dummyOnSoftEdge = false;
  private playerInvulnUntil = 0;
  private dummyInvulnUntil = 0;
  private localStunUntil = 0;
  private lastResolvedSlashKey = "";
  private outcomeSeq = 0;
  private lastAppliedOutcomeSeq = -1;
  private lastCombatOutcome: CombatOutcomeKind | null = null;
  private lastMissReason: "out_of_window" | "invuln" | "no_contact" | null = null;
  private combatWinnerHex: string | null = null;
  private regroupTarget: RootPair | null = null;
  private blockingLatchForRemoteSlash = false;
  private arenaRing: AbstractMesh | null = null;
  private lastBlockAnimation = "";
  /** 0 = ready grip/blade, 1 = full block pose (exp-smoothed). */
  private blockBlend = 0;
  private lungeActive = false;
  private lungeRecovering = false;
  private lungeHitConnected = false;
  private lungeOriginX = 0;
  /** Remote (dummy-seat) mid-slash close — mirrors local lunge for PvP reach. */
  private remoteLungeActive = false;
  private remoteLungeRecovering = false;
  private remoteLungeHitConnected = false;
  private remoteLungeOriginX = 0;
  /** Host resolve queued in simulationStep; App publishes + applies. */
  private pendingHostCombatOutcome: CombatOutcomeEvent | null = null;
  private lastSoloResolvedSlashSeq = -1;
  private prevSwordPhase: SwordPhase = "aiming";
  /** Authoritative duel-axis seats — reapplied after clips so anims cannot undo knockback. */
  private playerCombatX = -SEAT_HALF_SPACING;
  private dummyCombatX = SEAT_HALF_SPACING;
  private readonly matchPhase = new MatchPhaseMachine();
  private duelSessionActive = false;
  private localBodyOpacityMeshes: AbstractMesh[] = [];
  private localBodyOpaque = false;
  private lastLocalStunActive = false;

  /** True only during Fighting — gates slash resolve and Test slash. */
  isCombatOpen(): boolean {
    return this.matchPhase.combatOpen && !this.matchFrozen;
  }

  getMatchPhaseHud(): MatchPhaseHud {
    return this.matchPhase.hud();
  }

  getMatchPhase(): MatchPhase {
    return this.matchPhase.phase;
  }

  /**
   * Start or restart intro → countdown → walk-in → Fighting.
   * Used for solo practice and when a PvP opponent connects.
   */
  beginDuelSession(): void {
    this.duelSessionActive = true;
    this.matchFrozen = false;
    this.combatWinnerHex = null;
    this.lastCombatOutcome = null;
    this.lastMissReason = null;
    this.regroupTarget = null;
    this.clearLungeState();
    this.playerOnSoftEdge = false;
    this.dummyOnSoftEdge = false;
    this.playerInvulnUntil = 0;
    this.dummyInvulnUntil = 0;
    this.localStunUntil = 0;
    this.setLocalBodyOpaque(false);
    const snap = this.matchPhase.startMatch();
    this.playerCombatX = snap.playerX;
    this.dummyCombatX = snap.dummyX;
    this.applyCombatSeats();
    this.rebindWeaponAfterSeatChange();
    this.player?.controller.play("CombatIdle");
    this.dummy?.controller.play("CombatIdle");
  }

  /** Between rounds after a ring-out (best-of-3 continues). */
  beginNextRound(): boolean {
    const snap = this.matchPhase.startNextRound();
    if (!snap) return false;
    this.matchFrozen = false;
    this.combatWinnerHex = null;
    this.lastCombatOutcome = null;
    this.lastMissReason = null;
    this.regroupTarget = null;
    this.clearLungeState();
    this.playerOnSoftEdge = false;
    this.dummyOnSoftEdge = false;
    this.playerInvulnUntil = 0;
    this.dummyInvulnUntil = 0;
    this.localStunUntil = 0;
    this.setLocalBodyOpaque(false);
    this.lastSoloResolvedSlashSeq = -1;
    this.lastResolvedSlashKey = "";
    this.playerCombatX = snap.playerX;
    this.dummyCombatX = snap.dummyX;
    this.applyCombatSeats();
    this.rebindWeaponAfterSeatChange();
    this.player?.controller.play("CombatIdle");
    this.dummy?.controller.play("CombatIdle");
    return true;
  }

  private clearLungeState(): void {
    this.lungeActive = false;
    this.lungeRecovering = false;
    this.lungeHitConnected = false;
    this.remoteLungeActive = false;
    this.remoteLungeRecovering = false;
    this.remoteLungeHitConnected = false;
  }

  testSlash(): boolean {
    if (
      !this.status.motion.weaponControlEnabled ||
      this.status.motion.blocking ||
      this.matchFrozen ||
      !this.isCombatOpen() ||
      performance.now() < this.localStunUntil
    ) {
      return false;
    }
    if (!this.circleSword.slash()) return false;
    this.localSlashSeq += 1;
    this.beginAttackLunge();
    return true;
  }

  setMatchCombatSession(options: {
    active: boolean;
    isHost: boolean;
    localIdentityHex: string | null;
    remoteIdentityHex: string | null;
  }): void {
    const wasActive = this.matchCombatActive;
    this.matchCombatActive = options.active && Boolean(options.remoteIdentityHex);
    this.matchIsHost = options.isHost;
    this.localIdentityHex = options.localIdentityHex;
    this.remoteIdentityHex = options.remoteIdentityHex;
    if (!options.active) {
      this.matchFrozen = false;
      this.combatWinnerHex = null;
      this.lastCombatOutcome = null;
      this.remoteIntent = null;
      this.regroupTarget = null;
      this.playerOnSoftEdge = false;
      this.dummyOnSoftEdge = false;
      this.lastResolvedSlashKey = "";
      this.lastAppliedOutcomeSeq = -1;
      this.pendingHostCombatOutcome = null;
      this.clearLungeState();
      this.duelSessionActive = false;
      this.matchPhase.resetIdle();
      this.playerCombatX = -SEAT_HALF_SPACING;
      this.dummyCombatX = SEAT_HALF_SPACING;
      this.applyCombatSeats();
      this.setLocalBodyOpaque(false);
    } else if (this.matchCombatActive && !wasActive) {
      this.beginDuelSession();
    }
  }

  setRemoteCombatIntent(intent: RemoteCombatIntent | null): void {
    if (!intent) {
      this.remoteIntent = null;
      return;
    }
    if (!this.remoteIntent || intent.slashSeq > this.remoteIntent.slashSeq) {
      this.remoteSlashStartedAt = performance.now();
      this.remoteSlashSeqSeen = intent.slashSeq;
      this.remoteSlashAngle = Math.atan2(intent.guardY, intent.guardX || 0.0001);
      this.blockingLatchForRemoteSlash = this.phoneBlocking;
      this.beginRemoteAttackLunge();
    }
    this.remoteIntent = intent;
  }

  /** Drain host outcome produced in simulationStep (after tip refresh). */
  consumePendingHostCombatOutcome(): CombatOutcomeEvent | null {
    const pending = this.pendingHostCombatOutcome;
    this.pendingHostCombatOutcome = null;
    return pending;
  }

  getLocalCombatIntent(): CombatIntentPublish {
    return {
      blocking: this.phoneBlocking,
      slashSeq: this.localSlashSeq,
      guardX: this.status.motion.guardX,
      guardY: this.status.motion.guardY,
    };
  }

  getCombatHud(): {
    lastOutcome: CombatOutcomeKind | null;
    lastOutcomeSeq: number;
    lastMissReason: "out_of_window" | "invuln" | "no_contact" | null;
    winnerHex: string | null;
    frozen: boolean;
    phase: MatchPhase;
    countdownLabel: string | null;
    roundIndex: number;
    p1Wins: number;
    p2Wins: number;
    matchWinner: "p1" | "p2" | null;
    combatOpen: boolean;
  } {
    const phaseHud = this.matchPhase.hud();
    return {
      lastOutcome: this.lastCombatOutcome,
      lastOutcomeSeq: this.lastAppliedOutcomeSeq,
      lastMissReason: this.lastMissReason,
      winnerHex: this.combatWinnerHex,
      frozen: this.matchFrozen,
      phase: phaseHud.phase,
      countdownLabel: phaseHud.countdownLabel,
      roundIndex: phaseHud.roundIndex,
      p1Wins: phaseHud.p1Wins,
      p2Wins: phaseHud.p2Wins,
      matchWinner: phaseHud.matchWinner,
      combatOpen: phaseHud.combatOpen,
    };
  }

  tryHostResolveCombat(): CombatOutcomeEvent | null {
    if (!this.matchCombatActive || !this.matchIsHost || this.matchFrozen) return null;
    if (!this.isCombatOpen()) return null;
    if (!this.localIdentityHex || !this.remoteIdentityHex || !this.remoteIntent) return null;
    if (!this.player || !this.dummy) return null;

    const now = performance.now();
    const remoteProgress = this.estimateRemoteSlashProgress(now);
    const localProgress = this.circleSword.slashProgress;

    const localCombatBlade = pickAttackerBladePose({
      rootX: this.playerCombatX,
      opponentX: this.dummyCombatX,
      slashProgress: localProgress,
      guardX: this.status.motion.guardX,
      guardY: this.status.motion.guardY,
      physicalTip: this.status.motion.weaponTargetTip
        ? {
            x: this.status.motion.weaponTargetTip[0],
            y: this.status.motion.weaponTargetTip[1],
            z: this.status.motion.weaponTargetTip[2],
          }
        : null,
      physicalBase: this.status.motion.weaponTargetBase
        ? {
            x: this.status.motion.weaponTargetBase[0],
            y: this.status.motion.weaponTargetBase[1],
            z: this.status.motion.weaponTargetBase[2],
          }
        : null,
    });
    const localTip: [number, number, number] | null =
      localProgress !== null
        ? [localCombatBlade.tip.x, localCombatBlade.tip.y, localCombatBlade.tip.z]
        : this.status.motion.weaponTargetTip;
    const localBase: [number, number, number] | null =
      localProgress !== null
        ? [localCombatBlade.base.x, localCombatBlade.base.y, localCombatBlade.base.z]
        : this.status.motion.weaponTargetBase;

    const playerSnap = this.buildFighterSnapshot({
      identityHex: this.localIdentityHex,
      slashProgress: localProgress,
      slashAngle: this.circleSword.slashAngle,
      blocking: this.phoneBlocking,
      blockingBeforeWindow: this.blockingLatchForRemoteSlash,
      rootX: this.playerCombatX,
      onSoftEdge: this.playerOnSoftEdge,
      invulnerable: now < this.playerInvulnUntil,
      tip: localTip,
      base: localBase,
      guardX: this.status.motion.guardX,
      guardY: this.status.motion.guardY,
    });

    const remoteBlade = this.estimateRemoteBlade();
    const dummySnap = this.buildFighterSnapshot({
      identityHex: this.remoteIdentityHex,
      slashProgress: remoteProgress,
      slashAngle: remoteProgress !== null ? this.remoteSlashAngle : null,
      blocking: this.remoteIntent.blocking,
      blockingBeforeWindow: this.remoteBlockLatchForLocalSlash,
      rootX: this.dummyCombatX,
      onSoftEdge: this.dummyOnSoftEdge,
      invulnerable: now < this.dummyInvulnUntil,
      tip: remoteBlade.tip,
      base: remoteBlade.base,
      guardX: this.remoteIntent.guardX,
      guardY: this.remoteIntent.guardY,
    });

    const resolved = resolveCombat({ player: playerSnap, dummy: dummySnap });
    if (!resolved) {
      this.recordMissReason(playerSnap, dummySnap, localProgress, remoteProgress);
      return null;
    }
    this.lastMissReason = null;

    const resolveKey = `${resolved.kind}:${this.localSlashSeq}:${this.remoteIntent.slashSeq}`;
    if (resolveKey === this.lastResolvedSlashKey) return null;
    this.lastResolvedSlashKey = resolveKey;
    this.outcomeSeq += 1;

    return {
      roomCode: "",
      seq: this.outcomeSeq,
      kind: resolved.kind,
      actorIdentityHex: resolved.actorIdentityHex,
      targetIdentityHex: resolved.targetIdentityHex,
      playerRootX: resolved.playerRootX,
      dummyRootX: resolved.dummyRootX,
      winnerIdentityHex: resolved.winnerIdentityHex,
    };
  }

  /**
   * Pre-match / no-opponent path: local slash can hit the idle dummy.
   * Hit-only (no solo block/clash/ring-out).
   */
  tickSoloDummyCombat(): CombatOutcomeEvent | null {
    if (this.matchCombatActive || this.matchFrozen) return null;
    if (!this.duelSessionActive || !this.isCombatOpen()) return null;
    if (!this.player || !this.dummy) return null;
    if (this.localSlashSeq <= this.lastSoloResolvedSlashSeq) return null;

    const now = performance.now();
    const localProgress = this.circleSword.slashProgress;
    if (localProgress === null) return null;

    // Prefer duel-axis combat tip; fall back to live tip when it reaches farther.
    const blade = this.weaponTarget.snapshot();
    const combatBlade = pickAttackerBladePose({
      rootX: this.playerCombatX,
      opponentX: this.dummyCombatX,
      slashProgress: localProgress,
      guardX: this.status.motion.guardX,
      guardY: this.status.motion.guardY,
      physicalTip: {
        x: blade.swordTip[0],
        y: blade.swordTip[1],
        z: blade.swordTip[2],
      },
      physicalBase: {
        x: blade.swordBase[0],
        y: blade.swordBase[1],
        z: blade.swordBase[2],
      },
    });
    const tip: [number, number, number] = [
      combatBlade.tip.x,
      combatBlade.tip.y,
      combatBlade.tip.z,
    ];
    const base: [number, number, number] = [
      combatBlade.base.x,
      combatBlade.base.y,
      combatBlade.base.z,
    ];

    const playerSnap = this.buildFighterSnapshot({
      identityHex: "local",
      slashProgress: localProgress,
      slashAngle: this.circleSword.slashAngle,
      blocking: this.phoneBlocking,
      blockingBeforeWindow: false,
      rootX: this.playerCombatX,
      onSoftEdge: this.playerOnSoftEdge,
      invulnerable: now < this.playerInvulnUntil,
      tip,
      base,
      guardX: this.status.motion.guardX,
      guardY: this.status.motion.guardY,
    });
    const dummySnap = this.buildFighterSnapshot({
      identityHex: "dummy",
      slashProgress: null,
      slashAngle: null,
      blocking: false,
      blockingBeforeWindow: false,
      rootX: this.dummyCombatX,
      onSoftEdge: this.dummyOnSoftEdge,
      invulnerable: now < this.dummyInvulnUntil,
      tip: [this.dummyCombatX, 1.2, 0.4],
      base: [this.dummyCombatX, 1.0, 0.1],
      guardX: 0,
      guardY: 1,
    });

    const resolved = resolveCombat({ player: playerSnap, dummy: dummySnap });
    // Solo accepts hit and ring-out (soft-edge second push); skip block/clash.
    if (!resolved || (resolved.kind !== "hit" && resolved.kind !== "ringout")) {
      this.recordMissReason(playerSnap, dummySnap, localProgress, null);
      return null;
    }

    this.lastMissReason = null;
    this.lastSoloResolvedSlashSeq = this.localSlashSeq;
    this.outcomeSeq += 1;
    return {
      roomCode: "",
      seq: this.outcomeSeq,
      kind: resolved.kind,
      actorIdentityHex: "local",
      targetIdentityHex: "dummy",
      playerRootX: resolved.playerRootX,
      dummyRootX: resolved.dummyRootX,
      winnerIdentityHex: resolved.winnerIdentityHex,
    };
  }

  /** Diagnose why resolve returned null while a slash was in flight. */
  private recordMissReason(
    player: FighterSnapshot,
    dummy: FighterSnapshot,
    localProgress: number | null,
    remoteProgress: number | null,
  ): void {
    const playerSlashing =
      !player.blocking && isInHitWindow(localProgress ?? player.slashProgress);
    const dummySlashing =
      !dummy.blocking && isInHitWindow(remoteProgress ?? dummy.slashProgress);

    if (!playerSlashing && !dummySlashing) {
      this.lastMissReason = "out_of_window";
      return;
    }

    if (playerSlashing && !dummySlashing) {
      if (!bladeHitsBody(player.bladeBase, player.bladeTip, dummy.rootX)) {
        this.lastMissReason = "no_contact";
        return;
      }
      if (dummy.invulnerable) {
        this.lastMissReason = "invuln";
        return;
      }
    } else if (dummySlashing && !playerSlashing) {
      if (!bladeHitsBody(dummy.bladeBase, dummy.bladeTip, player.rootX)) {
        this.lastMissReason = "no_contact";
        return;
      }
      if (player.invulnerable) {
        this.lastMissReason = "invuln";
        return;
      }
    }

    this.lastMissReason = "no_contact";
  }

  applyCombatOutcome(outcome: CombatOutcomeEvent): void {
    if (outcome.seq <= this.lastAppliedOutcomeSeq) return;
    this.lastAppliedOutcomeSeq = outcome.seq;
    this.lastCombatOutcome = outcome.kind;
    this.playerOnSoftEdge = Math.abs(outcome.playerRootX) >= ARENA_RADIUS - 0.05;
    this.dummyOnSoftEdge = Math.abs(outcome.dummyRootX) >= ARENA_RADIUS - 0.05;

    const now = performance.now();
    if (this.player) {
      this.playerCombatX = outcome.playerRootX;
    }
    if (this.dummy) {
      this.dummyCombatX = outcome.dummyRootX;
    }
    this.applyCombatSeats();

    const localIsActor =
      outcome.actorIdentityHex === this.localIdentityHex ||
      outcome.actorIdentityHex === "local";

    if (outcome.kind === "hit") {
      if (localIsActor) {
        this.lungeHitConnected = true;
        this.lungeActive = false;
        this.lungeRecovering = false;
        this.remoteLungeActive = false;
        this.remoteLungeRecovering = false;
        this.player?.controller.play("AdvanceAfterHit");
        this.dummy?.controller.play("HitKnockback");
        this.dummyInvulnUntil = now + HIT_INVULN_MS;
      } else {
        this.remoteLungeHitConnected = true;
        this.remoteLungeActive = false;
        this.remoteLungeRecovering = false;
        this.lungeActive = false;
        this.lungeRecovering = false;
        this.dummy?.controller.play("AdvanceAfterHit");
        this.player?.controller.play("HitKnockback");
        this.playerInvulnUntil = now + HIT_INVULN_MS;
        this.localStunUntil = now + STUN_SECONDS * 1000;
        this.setLocalBodyOpaque(true);
      }
      this.regroupTarget = regroupTargets(
        {
          playerX: outcome.playerRootX,
          dummyX: outcome.dummyRootX,
        },
        localIsActor || outcome.actorIdentityHex === "local",
      );
      this.rebindWeaponAfterSeatChange();
    } else if (outcome.kind === "clash") {
      this.lungeHitConnected = true;
      this.lungeActive = false;
      this.lungeRecovering = false;
      this.remoteLungeHitConnected = true;
      this.remoteLungeActive = false;
      this.remoteLungeRecovering = false;
      this.player?.controller.play("HitKnockback");
      this.dummy?.controller.play("HitKnockback");
      this.playerInvulnUntil = now + STUN_SECONDS * 1000;
      this.dummyInvulnUntil = now + STUN_SECONDS * 1000;
      this.localStunUntil = now + STUN_SECONDS * 1000;
      this.setLocalBodyOpaque(true);
      window.setTimeout(() => {
        this.player?.controller.play("AdvanceAfterHit");
        this.dummy?.controller.play("AdvanceAfterHit");
      }, 200);
      // Clash: treat local as attacker for reseat (keep remote/dummy X).
      this.regroupTarget = regroupTargets(
        {
          playerX: outcome.playerRootX,
          dummyX: outcome.dummyRootX,
        },
        true,
      );
      this.rebindWeaponAfterSeatChange();
    } else if (outcome.kind === "blocked") {
      if (localIsActor) {
        // Attacker stunned; blocker stays free (no stun / no invuln lock).
        this.lungeHitConnected = true;
        this.lungeActive = false;
        this.lungeRecovering = false;
        this.remoteLungeActive = false;
        this.remoteLungeRecovering = false;
        this.player?.controller.play("BlockedStun");
        this.localStunUntil = now + BLOCK_ATTACKER_STUN_SECONDS * 1000;
        this.playerInvulnUntil = now + BLOCK_ATTACKER_STUN_SECONDS * 1000;
        this.setLocalBodyOpaque(true);
        this.dummy?.controller.play("BlockIdle");
      } else {
        // Local is blocker — never stunned; free to retaliate immediately.
        this.remoteLungeHitConnected = true;
        this.remoteLungeActive = false;
        this.remoteLungeRecovering = false;
        this.lungeActive = false;
        this.lungeRecovering = false;
        this.dummy?.controller.play("BlockedStun");
        this.player?.controller.play("BlockIdle");
      }
      this.regroupTarget = regroupTargets(
        {
          playerX: outcome.playerRootX,
          dummyX: outcome.dummyRootX,
        },
        localIsActor || outcome.actorIdentityHex === "local",
      );
      this.rebindWeaponAfterSeatChange();
    } else if (outcome.kind === "ringout") {
      this.matchFrozen = true;
      this.combatWinnerHex = outcome.winnerIdentityHex;
      this.regroupTarget = null;
      this.clearLungeState();
      const localWon =
        outcome.winnerIdentityHex === this.localIdentityHex ||
        outcome.winnerIdentityHex === "local";
      if (this.duelSessionActive) {
        const winnerSeat: "p1" | "p2" =
          this.matchCombatActive && !this.matchIsHost
            ? localWon
              ? "p2"
              : "p1"
            : localWon
              ? "p1"
              : "p2";
        this.matchPhase.onRingOut(winnerSeat);
      }
      if (localWon) {
        this.player?.controller.play("CombatIdle");
        this.dummy?.controller.play("HitKnockback");
      } else {
        this.dummy?.controller.play("CombatIdle");
        this.player?.controller.play("HitKnockback");
      }
    }
  }

  private beginAttackLunge(): void {
    if (!this.player) return;
    this.lungeOriginX = this.playerCombatX;
    this.lungeActive = true;
    this.lungeRecovering = false;
    this.lungeHitConnected = false;
    // New attack cancels seat regroup so the lunge can close range.
    this.regroupTarget = null;
    // Do not clear invuln early — short stun must block spam until the timer expires.
    this.lastBlockAnimation = "";
    this.player.controller.play("AttackSwing");
  }

  private beginRemoteAttackLunge(): void {
    if (!this.dummy) return;
    this.remoteLungeOriginX = this.dummyCombatX;
    this.remoteLungeActive = true;
    this.remoteLungeRecovering = false;
    this.remoteLungeHitConnected = false;
    this.regroupTarget = null;
  }

  /** Keep TransformNode seats in sync with combat authority (clips can overwrite). */
  private applyCombatSeats(): void {
    if (this.player) {
      this.player.root.position.set(this.playerCombatX, 0, 0);
    }
    if (this.dummy) {
      this.dummy.root.position.set(this.dummyCombatX, 0, 0);
    }
  }

  /** Re-solve grip/tip after large seat jumps (knockback, walk-in, stun). */
  private rebindWeaponAfterSeatChange(): void {
    this.applyCombatSeats();
    this.refreshWeaponTipForCombatSeats();
  }

  /** Reset seats / freeze after solo ring-out so the dummy duel can restart. */
  resetSoloDuel(): void {
    this.beginDuelSession();
    this.lastSoloResolvedSlashSeq = -1;
    this.lastResolvedSlashKey = "";
  }

  getCombatSeats(): { playerX: number; dummyX: number } {
    return { playerX: this.playerCombatX, dummyX: this.dummyCombatX };
  }

  private remoteBlockLatchForLocalSlash = false;

  private estimateRemoteSlashProgress(now: number): number | null {
    if (this.remoteSlashStartedAt === null || !this.remoteIntent) return null;
    if (this.remoteIntent.slashSeq !== this.remoteSlashSeqSeen) return null;
    if (this.remoteSlashSeqSeen <= 0) return null;
    const progress = (now - this.remoteSlashStartedAt) / (CUT_SECONDS * 1000);
    if (progress < 0 || progress > 1) return null;
    return progress;
  }

  private estimateRemoteBlade(): {
    tip: [number, number, number] | null;
    base: [number, number, number] | null;
  } {
    if (!this.dummy || !this.remoteIntent) return { tip: null, base: null };
    const progress = this.estimateRemoteSlashProgress(performance.now());
    const pose = estimateRemoteBladePose({
      rootX: this.dummyCombatX,
      opponentX: this.playerCombatX,
      slashProgress: progress,
      guardX: this.remoteIntent.guardX,
      guardY: this.remoteIntent.guardY,
    });
    return {
      base: [pose.base.x, pose.base.y, pose.base.z],
      tip: [pose.tip.x, pose.tip.y, pose.tip.z],
    };
  }

  private buildFighterSnapshot(args: {
    identityHex: string;
    slashProgress: number | null;
    slashAngle: number | null;
    blocking: boolean;
    blockingBeforeWindow: boolean;
    rootX: number;
    onSoftEdge: boolean;
    invulnerable: boolean;
    tip: [number, number, number] | null;
    base: [number, number, number] | null;
    guardX: number;
    guardY: number;
  }): FighterSnapshot {
    const tip = args.tip ?? [args.rootX, 1.2, 0.4];
    const base = args.base ?? [args.rootX, 1.0, 0.1];
    return {
      identityHex: args.identityHex,
      blocking: args.blocking,
      blockingBeforeWindow: args.blockingBeforeWindow,
      slashProgress: args.slashProgress,
      slashAngle: args.slashAngle,
      guardX: args.guardX,
      guardY: args.guardY,
      bladeTip: { x: tip[0], y: tip[1], z: tip[2] },
      bladeBase: { x: base[0], y: base[1], z: base[2] },
      rootX: args.rootX,
      onSoftEdge: args.onSoftEdge,
      invulnerable: args.invulnerable,
    };
  }

  /** Latest local GripPrimary world pose for Spacetime publish. */
  getLocalSwordNetworkPose(): PrimaryGripNetworkPose | null {
    const snapshot = this.weaponTarget.snapshot();
    if (snapshot.source !== "controller" || snapshot.sessionGeneration === null || snapshot.sequence === null) {
      return null;
    }
    return {
      type: "primary-grip",
      position: [...snapshot.worldPosition] as [number, number, number],
      rotation: [...snapshot.worldRotation] as QuaternionTuple,
      sessionGeneration: snapshot.sessionGeneration,
      sequence: snapshot.sequence,
    };
  }

  /** Apply opponent primary-grip pose from Spacetime (or clear with null). */
  setRemoteSwordNetworkPose(
    pose: PrimaryGripNetworkPose | null,
  ): void {
    if (!pose) {
      this.remoteActive = false;
      this.latestRemoteNetworkPose = null;
      this.remotePresentationInitialized = false;
      this.remotePoseAdmission.reset();
      return;
    }
    const priorGeneration = this.latestRemoteNetworkPose?.sessionGeneration;
    if (!isPrimaryGripNetworkPose(pose) || !this.remotePoseAdmission.accept(pose)) return;
    if (priorGeneration !== undefined && pose.sessionGeneration > priorGeneration) {
      this.remotePresentationInitialized = false;
    }
    this.remoteActive = true;
    this.latestRemoteNetworkPose = clonePrimaryGripNetworkPose(pose);
  }

  private resetCircleSword(): void {
    this.circleSword = new CircleSword();
    this.circleSession = "";
    this.lastSlashCount = 0;
    this.lastBlockAnimation = "";
    this.blockBlend = 0;
    this.status.motion.swordPhase = "aiming";
    this.status.motion.guardX = 0;
    this.status.motion.guardY = 0;
    this.status.motion.blocking = false;
  }
  private gameplayGeometry: WeaponGeometry | null = null;
  private v05HandContacts: V05HandContactsManifest | null = null;
  private v05ShoulderRestRoot: V05ShoulderRestManifest | null = null;
  private readonly presentationRotation = new Quaternion();
  private readonly weaponSmoothingRotation = new Quaternion();

  private player: CharacterInstance | null = null;
  private dummy: CharacterInstance | null = null;
  private poseRig: PoseRig | null = null;
  private weaponAttachment: WeaponAttachment | null = null;
  private weaponRoot: TransformNode | null = null;
  private remotePoseRig: PoseRig | null = null;
  private remoteWeaponAttachment: WeaponAttachment | null = null;
  private remoteWeaponRoot: TransformNode | null = null;
  private remoteWeaponTarget = new WeaponTarget();
  private remoteNeutralGripAnchor = new Vector3();
  private remoteReachCenterRootLocal = new Vector3();
  private remoteActive = false;
  private remotePresentationRotation = new Quaternion();
  private remotePresentationInitialized = false;
  private latestRemoteNetworkPose: PrimaryGripNetworkPose | null = null;
  private readonly remotePoseAdmission = new PrimaryGripSequenceAdmission();
  private gameplayNeutralWeaponRotation = Quaternion.Identity();
  private neutralWeaponRotation = Quaternion.Identity();
  private assetWeaponCorrection = Quaternion.Identity();
  private phoneToGameplayBasis = PHONE_TO_GAME_BASIS.clone();
  private latestControllerState: ControllerSample | null = null;
  private latchedControllerState: ControllerSample | null = null;
  private latestControllerReceivedAt = 0;
  private readonly phoneSequenceAdmission = new SessionSequenceAdmission();
  private simulatedMotionMode: "continuous" | SimulatedPoseName | null = null;
  private simulatedSequence = 0;
  private motionSmoothingEnabled = false;
  private torsoFollowEnabled = false;
  private presentationInitialized = false;
  private poseState: PoseState = "READY";
  private targetPoseState: PoseState = "READY";
  private reachFraction = POSE_REACH_FRACTIONS.READY;
  private targetReachFraction = POSE_REACH_FRACTIONS.READY;
  private shellBaseRadiusMeters = 0;
  private shellRadiusMeters = 0;
  private neutralForwardRoot = new Vector3(0, -1, 0);
  private presentationObserver: Observer<Scene> | null = null;

  private weaponDebugLine: LinesMesh | null = null;
  private gripDebugLine: LinesMesh | null = null;
  private shellDebugLine: LinesMesh | null = null;
  private targetDebugLine: LinesMesh | null = null;
  private shoulderDebugLine: LinesMesh | null = null;
  private rightIkDebugLine: LinesMesh | null = null;
  private leftIkDebugLine: LinesMesh | null = null;

  private disposed = false;
  private debugCamera = false;
  private followCameraInitialized = false;
  private accumulator = 0;
  private simulationTicks = 0;
  private lastStatusTime = 0;

  constructor(canvas: HTMLCanvasElement, statusListener: StatusListener) {
    this.canvas = canvas;
    this.statusListener = statusListener;
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      adaptToDeviceRatio: true,
    });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.025, 0.035, 0.055, 1);
    this.camera = this.createCamera();
    this.createLights();
    this.presentationObserver = this.scene.onAfterAnimationsObservable.add(() => {
      this.applyCombatSeats();
      this.applyPresentationPose();
    });
    this.renderStep = () => this.render();
    this.emitStatus(true);
  }

  async start(): Promise<void> {
    this.engine.runRenderLoop(this.renderStep);
    window.addEventListener("resize", this.handleResize);

    await this.loadDojo();
    await this.loadCharacters();
  }

  /** Plays a body animation without changing the authoritative reach state. */
  playAnimation(name: string, options?: AnimationPlayOptions): boolean {
    return this.player?.controller.play(name, options) ?? false;
  }

  resetPlayer(): boolean {
    this.resetCircleSword();
    this.setReachState("READY");
    return this.player?.controller.reset() ?? false;
  }

  /** Selects only the procedural weapon reach state; body animation is separate. */
  setReachState(state: PoseState): boolean {
    if (!POSE_STATES.includes(state)) return false;
    this.targetPoseState = state;
    this.targetReachFraction = POSE_REACH_FRACTIONS[state];
    this.status.motion.targetPoseState = state;
    this.emitStatus(true);
    return true;
  }

  setControllerState(sample: ControllerSample): boolean {
    if (
      !sample.quaternion.every((component) => Number.isFinite(component)) ||
      !Number.isInteger(sample.sessionGeneration) ||
      sample.sessionGeneration < 0 ||
      !Number.isInteger(sample.sequence) ||
      sample.sequence < 0
    ) {
      return false;
    }
    if (sample.source === "phone") {
      if (!this.status.motion.peerConnected) return false;

      const previousGeneration = this.phoneSequenceAdmission.generation;
      if (!this.phoneSequenceAdmission.accept(sample.sessionGeneration, sample.sequence)) {
        this.status.motion.outOfOrderSamples += 1;
        return false;
      }
      if (previousGeneration !== sample.sessionGeneration) {
        this.latestControllerState = null;
        this.latchedControllerState = null;
      }
      this.status.motion.sessionGeneration = sample.sessionGeneration;
    }

    this.latestControllerState = {
      ...sample,
      quaternion: [...sample.quaternion] as QuaternionTuple,
      rawQuaternion: sample.rawQuaternion
        ? ([...sample.rawQuaternion] as QuaternionTuple)
        : undefined,
      calibrationReferenceQuaternion: sample.calibrationReferenceQuaternion
        ? ([...sample.calibrationReferenceQuaternion] as QuaternionTuple)
        : undefined,
    };
    this.latestControllerReceivedAt = performance.now();
    if (this.simulatedMotionMode === null) {
      this.status.motion.source = sample.source;
      this.status.motion.rawDeviceQuaternion = sample.rawQuaternion
        ? ([...sample.rawQuaternion] as QuaternionTuple)
        : ([...sample.quaternion] as QuaternionTuple);
      this.status.motion.calibrationReferenceQuaternion = sample.calibrationReferenceQuaternion
        ? ([...sample.calibrationReferenceQuaternion] as QuaternionTuple)
        : null;
      this.status.motion.relativeQuaternion = [...sample.quaternion] as QuaternionTuple;
      this.status.motion.quaternion = [...sample.quaternion] as QuaternionTuple;
    }
    return true;
  }

  setMotionRelayStatus(relayStatus: RelayStatus): void {
    this.status.motion.connection = relayStatus.connection;
    this.status.motion.room = relayStatus.room;
    this.status.motion.peerConnected = relayStatus.peerConnected;
    this.status.motion.samplesPerSecond = relayStatus.samplesPerSecond;

    if (
      this.simulatedMotionMode === null &&
      relayStatus.peerConnected &&
      relayStatus.sessionGeneration !== null &&
      relayStatus.sessionGeneration !== this.phoneSequenceAdmission.generation
    ) {
      this.phoneSequenceAdmission.begin(relayStatus.sessionGeneration);
      this.latestControllerState = null;
      this.latchedControllerState = null;
      this.status.motion.source = "none";
      this.status.motion.streamState = "idle";
      this.status.motion.lastSequence = null;
      this.status.motion.sampleAgeMs = null;
      this.status.motion.calibrated = false;
      this.status.motion.quaternion = null;
      this.status.motion.rawDeviceQuaternion = null;
      this.status.motion.calibrationReferenceQuaternion = null;
      this.status.motion.relativeQuaternion = null;
    }

    if (this.simulatedMotionMode === null) {
      this.status.motion.sessionGeneration = relayStatus.sessionGeneration;
      this.status.motion.lastSequence = relayStatus.lastSequence;
      this.status.motion.sampleAgeMs = relayStatus.sampleAgeMs;
      this.status.motion.calibrated = relayStatus.calibrated;
      this.status.motion.quaternion = relayStatus.quaternion
        ? ([...relayStatus.quaternion] as QuaternionTuple)
        : null;
      this.status.motion.relativeQuaternion = relayStatus.quaternion
        ? ([...relayStatus.quaternion] as QuaternionTuple)
        : null;
      this.status.motion.rawDeviceQuaternion = relayStatus.rawQuaternion
        ? ([...relayStatus.rawQuaternion] as QuaternionTuple)
        : null;
      this.status.motion.calibrationReferenceQuaternion = relayStatus.calibrationReferenceQuaternion
        ? ([...relayStatus.calibrationReferenceQuaternion] as QuaternionTuple)
        : null;
    }
    this.status.motion.relayRttMs = relayStatus.relayRttMs;
    this.status.motion.outOfOrderSamples = relayStatus.outOfOrderSamples;
    // Don't force a React status clone here — the render loop already emits ~4 Hz.
  }

  setSimulatedMotion(enabled: boolean): void {
    this.simulatedMotionMode = enabled ? "continuous" : null;
    this.resetSimulatedInputState();
    this.emitStatus(true);
  }

  setSimulatedPose(pose: SimulatedPoseName): void {
    this.simulatedMotionMode = pose;
    this.resetSimulatedInputState();
    this.emitStatus(true);
  }

  setMotionSmoothingEnabled(enabled: boolean): void {
    this.motionSmoothingEnabled = enabled;
    this.status.motion.smoothingEnabled = enabled;
    this.emitStatus(true);
  }

  /** Toggles presentation-only torso/shoulder follow without touching targets. */
  setTorsoFollowEnabled(enabled: boolean): void {
    this.torsoFollowEnabled = enabled;
    this.status.motion.torsoFollowEnabled = enabled;
    this.emitStatus(true);
  }

  setWeaponDebugVisibility(enabled: boolean): void {
    this.status.motion.showWeaponDebug = enabled;
    if (this.weaponDebugLine) this.weaponDebugLine.isVisible = enabled;
    if (this.gripDebugLine) this.gripDebugLine.isVisible = enabled;
    if (this.shellDebugLine) this.shellDebugLine.isVisible = enabled;
    if (this.targetDebugLine) this.targetDebugLine.isVisible = enabled;
    if (this.shoulderDebugLine) this.shoulderDebugLine.isVisible = enabled;
    this.emitStatus(true);
  }

  setIkDebugVisibility(enabled: boolean): void {
    this.status.motion.showIkDebug = enabled;
    if (this.rightIkDebugLine) this.rightIkDebugLine.isVisible = enabled;
    if (this.leftIkDebugLine) this.leftIkDebugLine.isVisible = enabled;
    this.emitStatus(true);
  }

  setDebugCamera(enabled: boolean): void {
    this.debugCamera = enabled;
    this.status.cameraMode = enabled ? "debug" : "follow";
    if (enabled) {
      this.camera.attachControl(this.canvas, true);
    } else {
      this.camera.detachControl();
      this.followCameraInitialized = false;
      this.updateFollowCamera(0);
    }
    this.emitStatus(true);
  }

  get isDebugCamera(): boolean {
    return this.debugCamera;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("resize", this.handleResize);
    if (this.presentationObserver) {
      this.scene.onAfterAnimationsObservable.remove(this.presentationObserver);
      this.presentationObserver = null;
    }
    this.engine.stopRenderLoop(this.renderStep);
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly handleResize = (): void => {
    this.engine.resize();
  };

  private createCamera(): ArcRotateCamera {
    const forward = new Vector3(1, 0, 0);
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();
    const position = LOCAL_PLAYER_POSITION
      .add(Vector3.Up().scale(FOLLOW_CAMERA_HEIGHT))
      .subtract(forward.scale(FOLLOW_CAMERA_DISTANCE))
      .add(right.scale(FOLLOW_CAMERA_SIDE_OFFSET));
    const target = LOCAL_PLAYER_POSITION
      .add(Vector3.Up().scale(FOLLOW_CAMERA_LOOK_HEIGHT))
      .add(forward.scale(FOLLOW_CAMERA_LOOK_AHEAD));
    const camera = new ArcRotateCamera(
      "game-camera",
      0,
      Math.PI / 2,
      Vector3.Distance(position, target),
      target,
      this.scene,
    );
    camera.setPosition(position);
    camera.fov = 0.92;
    camera.lowerRadiusLimit = 0.05;
    camera.upperRadiusLimit = 22;
    camera.lowerBetaLimit = 0.05;
    camera.upperBetaLimit = Math.PI - 0.05;
    camera.wheelPrecision = 70;
    camera.panningSensibility = 0;
    camera.minZ = 0.03;
    camera.maxZ = 100;
    this.scene.activeCamera = camera;
    return camera;
  }

  /** Smoothly follows behind the local fighter while looking through the guard. */
  private updateFollowCamera(dt: number): void {
    if (this.debugCamera) return;
    const root = this.player?.root;
    const origin = root
      ? Vector3.TransformCoordinates(Vector3.Zero(), root.getWorldMatrix())
      : LOCAL_PLAYER_POSITION;
    const forward = root ? this.fighterForward(root) : new Vector3(1, 0, 0);
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();
    const stunned = performance.now() < this.localStunUntil;
    const camDistance = stunned ? FOLLOW_CAMERA_STUN_DISTANCE : FOLLOW_CAMERA_DISTANCE;
    const desiredPosition = origin
      .add(Vector3.Up().scale(FOLLOW_CAMERA_HEIGHT))
      .subtract(forward.scale(camDistance))
      .add(right.scale(FOLLOW_CAMERA_SIDE_OFFSET));
    const desiredTarget = origin
      .add(Vector3.Up().scale(FOLLOW_CAMERA_LOOK_HEIGHT))
      .add(forward.scale(FOLLOW_CAMERA_LOOK_AHEAD));
    const alpha = this.followCameraInitialized
      ? 1 - Math.exp(-FOLLOW_CAMERA_DAMPING * Math.max(0, dt))
      : 1;
    const position = Vector3.Lerp(this.camera.position, desiredPosition, alpha);
    const target = Vector3.Lerp(this.camera.target, desiredTarget, alpha);
    this.camera.setTarget(target);
    this.camera.setPosition(position);
    this.followCameraInitialized = true;
  }

  /** Fade the local avatar without fading its weapon, which must remain readable. */
  private makeLocalBodyTranslucent(meshes: AbstractMesh[]): void {
    this.localBodyOpacityMeshes = [];
    const belongsToWeapon = (mesh: AbstractMesh): boolean => {
      let node: TransformNode | null = mesh;
      while (node) {
        if (node === this.weaponRoot || /shinai|weaponroot/i.test(node.name)) return true;
        node = node.parent as TransformNode | null;
      }
      return false;
    };
    const opacityForMesh = (mesh: AbstractMesh): number => {
      const name = mesh.name.toLowerCase();
      if (/hand|thumb|forearm|lower_arm/.test(name)) return LOCAL_HAND_OPACITY;
      if (/pelvis|thigh|shin|hakama|shoe/.test(name)) return LOCAL_LEG_OPACITY;
      return LOCAL_UPPER_BODY_OPACITY;
    };
    const isOutlinedHand = (mesh: AbstractMesh): boolean =>
      /hand|thumb/.test(mesh.name.toLowerCase());
    const addControlOutline = (mesh: AbstractMesh, width: number): void => {
      mesh.renderOutline = true;
      mesh.outlineColor = Color3.Black();
      mesh.outlineWidth = width;
    };
    const configureOpacity = (material: Material, opacity: number): void => {
      material.alpha = opacity;
      material.transparencyMode = opacity >= 0.999
        ? Material.MATERIAL_OPAQUE
        : Material.MATERIAL_ALPHABLEND;
      material.forceDepthWrite = opacity >= 0.999;
      if (material instanceof MultiMaterial) {
        for (const child of material.subMaterials) {
          if (child) configureOpacity(child, opacity);
        }
      }
    };

    for (const [index, mesh] of meshes.entries()) {
      if (mesh.getTotalVertices() <= 0) continue;
      if (belongsToWeapon(mesh)) {
        addControlOutline(mesh, LOCAL_SWORD_OUTLINE_WIDTH);
        continue;
      }
      if (isOutlinedHand(mesh)) addControlOutline(mesh, LOCAL_HAND_OUTLINE_WIDTH);
      if (!mesh.material) continue;
      const material = mesh.material instanceof MultiMaterial
        ? mesh.material.clone(`${mesh.material.name}-local-${index}`, true)
        : mesh.material.clone(`${mesh.material.name}-local-${index}`);
      if (!material) continue;
      configureOpacity(material, opacityForMesh(mesh));
      mesh.material = material;
      mesh.visibility = 1;
      this.localBodyOpacityMeshes.push(mesh);
    }
    this.localBodyOpaque = false;
  }

  /** Opaque body while local is hit/block-stunned; weapon stays visible either way. */
  private setLocalBodyOpaque(opaque: boolean): void {
    if (this.localBodyOpaque === opaque) return;
    this.localBodyOpaque = opaque;
    const opacityForMesh = (mesh: AbstractMesh): number => {
      if (opaque) return LOCAL_STUN_BODY_OPACITY;
      const name = mesh.name.toLowerCase();
      if (/hand|thumb|forearm|lower_arm/.test(name)) return LOCAL_HAND_OPACITY;
      if (/pelvis|thigh|shin|hakama|shoe/.test(name)) return LOCAL_LEG_OPACITY;
      return LOCAL_UPPER_BODY_OPACITY;
    };
    for (const mesh of this.localBodyOpacityMeshes) {
      const material = mesh.material;
      if (!material) continue;
      const opacity = opacityForMesh(mesh);
      material.alpha = opacity;
      material.transparencyMode = opacity >= 0.999
        ? Material.MATERIAL_OPAQUE
        : Material.MATERIAL_ALPHABLEND;
      material.forceDepthWrite = opacity >= 0.999;
      if (material instanceof MultiMaterial) {
        for (const child of material.subMaterials) {
          if (!child) continue;
          child.alpha = opacity;
          child.transparencyMode = opacity >= 0.999
            ? Material.MATERIAL_OPAQUE
            : Material.MATERIAL_ALPHABLEND;
          child.forceDepthWrite = opacity >= 0.999;
        }
      }
    }
  }

  private syncLocalStunPresentation(): void {
    const stunned = performance.now() < this.localStunUntil;
    if (stunned === this.lastLocalStunActive) return;
    this.lastLocalStunActive = stunned;
    if (!stunned) this.setLocalBodyOpaque(false);
  }

  private createLights(): void {
    const hemi = new HemisphericLight("dojo-sky", new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 1.15;
    hemi.diffuse = new Color3(0.88, 0.91, 1);
    hemi.groundColor = new Color3(0.18, 0.12, 0.1);

    const key = new DirectionalLight("dojo-key", new Vector3(-0.35, -1, 0.45), this.scene);
    key.position = new Vector3(4, 9, -6);
    key.intensity = 1.1;
    key.diffuse = new Color3(1, 0.89, 0.76);
  }

  private async loadDojo(): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync("", "/assets/dojo/", "scene.gltf", this.scene);
      const dojoRoot =
        result.transformNodes.find((node) => node.name === "__root__") ??
        result.meshes.find((mesh) => mesh.name === "__root__");
      if (dojoRoot) {
        dojoRoot.scaling = new Vector3(DOJO_SCALE, DOJO_SCALE, DOJO_SCALE);
      } else {
        for (const mesh of result.meshes) {
          mesh.scaling = new Vector3(DOJO_SCALE, DOJO_SCALE, DOJO_SCALE);
        }
      }
      this.status.dojo = "ready";
      this.ensureArenaRing();
      this.emitStatus(true);
    } catch (error) {
      this.reportError("Dojo failed to load", error);
      this.status.dojo = "error";
      this.ensureArenaRing();
      this.emitStatus(true);
    }
  }

  private ensureArenaRing(): void {
    if (this.arenaRing) {
      this.arenaRing.dispose(false, true);
      this.arenaRing = null;
    }
    // CreateTorus is horizontal (ring in XZ, hole along +Y). Keep it on the
    // default render group so depth testing places characters in front of it.
    const ring = MeshBuilder.CreateTorus(
      "duelArenaRing",
      {
        diameter: ARENA_RADIUS * 2,
        thickness: 0.1,
        tessellation: 96,
      },
      this.scene,
    );
    ring.position = new Vector3(0, 0.02, 0);
    ring.rotationQuaternion = Quaternion.Identity();
    ring.rotation.setAll(0);
    ring.isPickable = false;
    ring.receiveShadows = false;
    ring.renderingGroupId = 0;
    const material = new StandardMaterial("duelArenaRingMat", this.scene);
    material.diffuseColor = new Color3(0.95, 0.28, 0.18);
    material.emissiveColor = new Color3(0.5, 0.09, 0.05);
    material.specularColor = new Color3(0.15, 0.1, 0.08);
    // Opaque + depth write so the ring stays on the floor under the fighters
    // when the camera pans (transparent materials often paint over skinned meshes).
    material.alpha = 1;
    material.transparencyMode = StandardMaterial.MATERIAL_OPAQUE;
    material.forceDepthWrite = true;
    material.zOffset = 2;
    ring.material = material;
    this.arenaRing = ring;
  }

  private async loadCharacters(): Promise<void> {
    await this.validateV05Manifest();
    const playerPromise = this.loadCharacter("player", LOCAL_PLAYER_POSITION.clone(), LOCAL_PLAYER_ROTATION_Y);
    const dummyPromise = this.loadCharacter("dummy", REMOTE_DUMMY_POSITION.clone(), REMOTE_DUMMY_ROTATION_Y);

    const [playerResult, dummyResult] = await Promise.allSettled([playerPromise, dummyPromise]);
    if (playerResult.status === "fulfilled") {
      this.player = playerResult.value;
      this.playerCombatX = this.player.root.position.x;
      this.status.player = "ready";
      this.status.currentPlayerAnimation = this.player.controller.currentName;
      this.status.discoveredAnimations = [...this.player.controller.discoveredNames];
      this.status.missingAnimations = [...this.player.controller.missingNames];
    } else {
      this.status.player = "error";
      this.reportError("Player failed to load", playerResult.reason);
    }

    if (dummyResult.status === "fulfilled") {
      this.dummy = dummyResult.value;
      this.dummyCombatX = this.dummy.root.position.x;
      this.status.dummy = "ready";
      this.status.currentDummyAnimation = this.dummy.controller.currentName;
    } else {
      this.status.dummy = "error";
      this.reportError("Dummy failed to load", dummyResult.reason);
    }

    this.emitStatus(true);
  }

  private async validateV05Manifest(): Promise<void> {
    try {
      const response = await fetch(PLAYER_ASSET_PATH + PLAYER_ASSET_MANIFEST_FILE);
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      const manifest = await response.json() as {
        asset?: string;
        actions?: Array<{ name?: string }>;
        weaponControl?: Record<string, unknown>;
        armMeasurements?: {
          rightShoulderJointRest?: unknown;
          leftShoulderJointRest?: unknown;
        };
        handContacts?: {
          right?: {
            bone?: unknown;
            grip?: unknown;
            localPosition?: unknown;
            rotationOffset?: unknown;
          };
          left?: {
            bone?: unknown;
            grip?: unknown;
            localPosition?: unknown;
            rotationOffset?: unknown;
          };
        };
      };
      const actionNames = new Set(
        (manifest.actions ?? []).map((action) => action.name).filter(
          (name): name is string => typeof name === "string",
        ),
      );
      const missingAnimations = EXPECTED_ANIMATIONS.filter((name) => !actionNames.has(name));
      const requiredWeaponKeys = [
        "weaponRoot",
        "primaryGrip",
        "secondaryGrip",
        "bladeBase",
        "bladeTip",
        "bladeUp",
        "reachCenter",
      ];
      const missingWeaponKeys = requiredWeaponKeys.filter(
        (key) => typeof manifest.weaponControl?.[key] !== "string",
      );
      const isFiniteTuple = (value: unknown, length: number): value is number[] =>
        Array.isArray(value) &&
        value.length === length &&
        value.every((component) => typeof component === "number" && Number.isFinite(component));
      const rightContact = manifest.handContacts?.right;
      const leftContact = manifest.handContacts?.left;
      const contactsValid = (
        rightContact?.bone === "hand.R" &&
        rightContact.grip === "GripPrimary" &&
        isFiniteTuple(rightContact.localPosition, 3) &&
        isFiniteTuple(rightContact.rotationOffset, 4) &&
        leftContact?.bone === "hand.L" &&
        leftContact.grip === "GripSecondary" &&
        isFiniteTuple(leftContact.localPosition, 3) &&
        isFiniteTuple(leftContact.rotationOffset, 4)
      );
      const rightShoulderRest = manifest.armMeasurements?.rightShoulderJointRest;
      const leftShoulderRest = manifest.armMeasurements?.leftShoulderJointRest;
      const shoulderAnchorsValid =
        isFiniteTuple(rightShoulderRest, 3) && isFiniteTuple(leftShoulderRest, 3);
      if (manifest.asset !== "Baizhong_Kendo_Animations_v07.glb" ||
        missingAnimations.length > 0 ||
        missingWeaponKeys.length > 0 ||
        !contactsValid) {
        throw new Error(
          "v07 manifest mismatch (animations=" + (missingAnimations.join(",") || "ok") +
          " markers=" + (missingWeaponKeys.join(",") || "ok") +
          " handContacts=" + (contactsValid ? "ok" : "invalid") + ")",
        );
      }
      const validRightContact = rightContact as {
        bone: string;
        grip: string;
        localPosition: number[];
        rotationOffset: number[];
      };
      const validLeftContact = leftContact as {
        bone: string;
        grip: string;
        localPosition: number[];
        rotationOffset: number[];
      };
      this.v05HandContacts = {
        right: {
          bone: validRightContact.bone,
          grip: validRightContact.grip,
          localPosition: [...validRightContact.localPosition] as [number, number, number],
          rotationOffset: [...validRightContact.rotationOffset] as [number, number, number, number],
        },
        left: {
          bone: validLeftContact.bone,
          grip: validLeftContact.grip,
          localPosition: [...validLeftContact.localPosition] as [number, number, number],
          rotationOffset: [...validLeftContact.rotationOffset] as [number, number, number, number],
        },
      };
      if (shoulderAnchorsValid) {
        this.v05ShoulderRestRoot = {
          right: manifestRestPointToRuntimeRoot(rightShoulderRest),
          left: manifestRestPointToRuntimeRoot(leftShoulderRest),
        };
      } else {
        this.v05ShoulderRestRoot = null;
        this.status.motion.shoulderAnchorSource = "rest-capture";
        console.warn(
          "[Chambara] v05 manifest shoulder anchors unavailable; using rest skeleton capture for validation fallback",
        );
      }
      this.status.v05Manifest = "ready";
    } catch (error) {
      this.v05HandContacts = null;
      this.v05ShoulderRestRoot = null;
      this.status.motion.shoulderAnchorSource = "rest-capture";
      console.warn(
        "[Chambara] v05 manifest shoulder anchors unavailable; using rest skeleton capture for validation fallback",
      );
      this.status.v05Manifest = "error";
      this.reportError("v05 manifest failed validation", error);
    }
    this.emitStatus(true);
  }

  private async loadCharacter(
    role: "player" | "dummy",
    position: Vector3,
    rotationY: number,
  ): Promise<CharacterInstance> {
    const result = await SceneLoader.ImportMeshAsync(
      "",
      PLAYER_ASSET_PATH,
      PLAYER_ASSET_FILE,
      this.scene,
    );
    const root = this.findRoot(result.transformNodes, result.meshes);
    root.position = position;
    // The GLB root may already carry a rotationQuaternion, in which case
    // writing Euler rotation.y is ignored. Set the fighter-facing transform
    // explicitly so the player and dummy have opposite forward directions.
    root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), rotationY);
    root.rotation.setAll(0);

    const controller = new AnimationController(result.animationGroups, EXPECTED_ANIMATIONS, (name) => {
      if (role === "player") {
        this.status.currentPlayerAnimation = name;
      } else {
        this.status.currentDummyAnimation = name;
      }
      this.emitStatus(true);
    });

    if (role === "player") {
      this.status.weaponNodes = this.inspectWeaponNodes(result.transformNodes, result.meshes, result.skeletons);
      this.configurePlayerPose(root, result.skeletons, result.meshes, result.transformNodes);
      this.makeLocalBodyTranslucent(result.meshes);
    } else {
      this.configureRemotePose(root, result.skeletons, result.meshes, result.transformNodes);
    }

    // Capture gameplay/rest anchors before starting the first body clip. Body
    // animation remains presentation-only and cannot alter the solver's
    // initial measurements.
    controller.reset();
    this.stripRootMotion(result.animationGroups, root);

    for (const mesh of result.meshes) mesh.isPickable = false;
    return { root, controller, importedMeshes: result.meshes };
  }

  /**
   * Remove root translation keys so HitKnockback / Advance clips cannot slide
   * the fighter off the authoritative duel seat.
   */
  private stripRootMotion(
    groups: readonly import("@babylonjs/core").AnimationGroup[],
    root: TransformNode,
  ): void {
    for (const group of groups) {
      const targeted = [...(group.targetedAnimations ?? [])];
      for (const entry of targeted) {
        if (entry.target !== root) continue;
        const prop = entry.animation?.targetProperty ?? "";
        if (/position/i.test(prop)) {
          group.removeTargetedAnimation(entry.animation);
        }
      }
    }
  }

  private configurePlayerPose(
    root: TransformNode,
    skeletons: Skeleton[],
    meshes: AbstractMesh[],
    transformNodes: TransformNode[],
  ): void {
    const skeleton = skeletons[0];
    const skeletonMesh = meshes.find((mesh) => mesh.skeleton === skeleton) ??
      meshes.find((mesh) => mesh.skeleton !== null) ??
      meshes[0];
    if (!skeleton || !skeletonMesh) {
      this.reportError("Player pose rig unavailable", new Error("Skinned skeleton mesh was not found"));
      return;
    }

    root.computeWorldMatrix(true);
    skeletonMesh.computeWorldMatrix(true);
    skeleton.computeAbsoluteMatrices(true);
    const playerForward = this.fighterForward(root);
    this.gameplayNeutralWeaponRotation = neutralSwordRotation(playerForward);
    this.status.motion.neutralWeaponQuaternion = quaternionToTuple(
      this.gameplayNeutralWeaponRotation,
    );
    this.assetWeaponCorrection = Quaternion.Identity();

    const attachment = this.captureWeaponAttachment(root, transformNodes);
    if (!attachment) return;

    this.weaponAttachment = attachment;
    this.weaponRoot = attachment.weaponRoot;
    this.assetWeaponCorrection = weaponFrameCorrection(attachment.frame);
    this.gameplayGeometry = transformWeaponGeometryToGameplay(
      attachment.geometry,
      this.assetWeaponCorrection,
    );
    this.phoneToGameplayBasis = derivePhoneToGameplayBasis(
      this.gameplayNeutralWeaponRotation,
      {
        right: this.gameplayGeometry.bladeRight,
        forward: this.gameplayGeometry.bladeForward,
        up: this.gameplayGeometry.bladeUp,
      },
      playerForward,
    );
    this.status.motion.phoneToGameplayBasisQuaternion = quaternionToTuple(
      this.phoneToGameplayBasis,
    );
    this.weaponTarget.setGeometry(this.gameplayGeometry);
    this.neutralGripAnchor.copyFrom(this.rootPointFromWorld(root, attachment.primaryGripWorld));
    this.reachCenterRootLocal.copyFrom(attachment.reachCenterRootLocal);
    this.shellBaseRadiusMeters = Math.max(
      this.neutralGripAnchor.subtract(this.reachCenterRootLocal).length() /
        POSE_REACH_FRACTIONS.READY,
      0.01,
    );
    this.status.motion.controlNode = attachment.weaponRoot.name;
    this.status.motion.primaryGripSource = attachment.primaryGrip.name;
    this.status.motion.secondaryGripSource = attachment.secondaryGrip.name;
    this.status.motion.weaponMarkersStable = attachment.markersStable;
    this.status.motion.reachCenterRootLocal = vectorTuple(this.reachCenterRootLocal);
    this.status.motion.weaponGeometryGripSpacingMeters = attachment.geometry.gripSpacing;
    this.status.motion.weaponGeometryBladeLengthMeters = attachment.geometry.bladeLength;
    this.status.motion.bladeForwardInPrimaryFrame = vectorTuple(
      attachment.frame.bladeForwardInPrimaryFrame,
    );
    this.status.motion.bladeUpInPrimaryFrame = vectorTuple(
      attachment.frame.bladeUpInPrimaryFrame,
    );
    this.status.motion.bladeRightInPrimaryFrame = vectorTuple(
      attachment.frame.bladeRightInPrimaryFrame,
    );
    this.status.motion.assetFrameCorrectionQuaternion = quaternionToTuple(
      this.assetWeaponCorrection,
    );

    this.neutralWeaponRotation = this.gameplayNeutralWeaponRotation
      .clone()
      .multiply(this.assetWeaponCorrection)
      .normalize();
    this.status.motion.visibleNeutralWeaponQuaternion = quaternionToTuple(
      this.neutralWeaponRotation,
    );

    const neutralGripWorld = this.rootRelativeAnchorToWorld(root);
    this.setWeaponRootPose(neutralGripWorld, this.neutralWeaponRotation);
    this.weaponTarget.setRest(
      this.neutralGripAnchor,
      neutralGripWorld,
      this.gameplayNeutralWeaponRotation,
    );
    this.syncWeaponTargetStatus();

    const rightArm = this.createArmRig(
      root,
      "right",
      skeleton,
      skeletonMesh,
      this.findBone(skeleton, "shoulder.R"),
      this.findBone(skeleton, "upper_arm.R"),
      this.findBone(skeleton, "forearm.R"),
      this.findBone(skeleton, "hand.R"),
    );
    const leftArm = this.createArmRig(
      root,
      "left",
      skeleton,
      skeletonMesh,
      this.findBone(skeleton, "shoulder.L"),
      this.findBone(skeleton, "upper_arm.L"),
      this.findBone(skeleton, "forearm.L"),
      this.findBone(skeleton, "hand.L"),
    );

    this.poseRig = {
      root,
      mesh: skeletonMesh,
      skeleton,
      spine: this.findBone(skeleton, "spine"),
      chest: this.findBone(skeleton, "chest"),
      rightArm,
      leftArm,
    };
    this.status.motion.rightArmMaxReachMeters = rightArm
      ? rightArm.firstLength + rightArm.secondLength
      : null;
    this.status.motion.leftArmMaxReachMeters = leftArm
      ? leftArm.firstLength + leftArm.secondLength
      : null;
    this.applyManifestShoulderAnchors();
    // Contact offsets come from the v04-authored neutral hand frame persisted
    // in the v05 manifest; the independent v05 marker poses are never used as
    // an anatomical wrist heuristic.
    this.applyManifestHandContacts();
    this.shellRadiusMeters = Math.max(
      this.reachCenterRootLocal.subtract(this.neutralGripAnchor).length(),
      0.01,
    );
    this.status.motion.reachShellRadiusMeters = this.shellRadiusMeters;
    this.neutralForwardRoot = this.rootDirectionFromWorld(
      root,
      this.gameplayNeutralWeaponRotation,
      this.gameplayBladeForwardAxis(),
    );
    this.status.motion.ikFinite = Boolean(rightArm && leftArm);
    this.createDebugGeometry();
  }

  /** Capture the opponent fighter's weapon hierarchy for Spacetime-driven poses. */
  private configureRemotePose(
    root: TransformNode,
    skeletons: Skeleton[],
    meshes: AbstractMesh[],
    transformNodes: TransformNode[],
  ): void {
    const skeleton = skeletons[0];
    const skeletonMesh = meshes.find((mesh) => mesh.skeleton === skeleton) ??
      meshes.find((mesh) => mesh.skeleton !== null) ??
      meshes[0];
    if (!skeleton || !skeletonMesh) {
      this.reportError("Remote pose rig unavailable", new Error("Skinned skeleton mesh was not found"));
      return;
    }

    const attachment = this.captureWeaponAttachment(root, transformNodes);
    if (!attachment) return;

    // Prefer player-derived gameplay geometry; fall back to this fighter's frame.
    if (!this.gameplayGeometry) {
      const correction = weaponFrameCorrection(attachment.frame);
      this.gameplayGeometry = transformWeaponGeometryToGameplay(attachment.geometry, correction);
      this.assetWeaponCorrection = correction;
    }

    this.remoteWeaponAttachment = attachment;
    this.remoteWeaponRoot = attachment.weaponRoot;
    this.remoteWeaponTarget.setGeometry(this.gameplayGeometry);
    this.remoteNeutralGripAnchor.copyFrom(this.rootPointFromWorld(root, attachment.primaryGripWorld));
    this.remoteReachCenterRootLocal.copyFrom(attachment.reachCenterRootLocal);

    const rightArm = this.createArmRig(
      root,
      "right",
      skeleton,
      skeletonMesh,
      this.findBone(skeleton, "shoulder.R"),
      this.findBone(skeleton, "upper_arm.R"),
      this.findBone(skeleton, "forearm.R"),
      this.findBone(skeleton, "hand.R"),
    );
    const leftArm = this.createArmRig(
      root,
      "left",
      skeleton,
      skeletonMesh,
      this.findBone(skeleton, "shoulder.L"),
      this.findBone(skeleton, "upper_arm.L"),
      this.findBone(skeleton, "forearm.L"),
      this.findBone(skeleton, "hand.L"),
    );
    this.remotePoseRig = {
      root,
      mesh: skeletonMesh,
      skeleton,
      spine: this.findBone(skeleton, "spine"),
      chest: this.findBone(skeleton, "chest"),
      rightArm,
      leftArm,
    };

    if (this.v05HandContacts) {
      if (rightArm) {
        rightArm.handContactLocal.copyFrom(Vector3.FromArray(this.v05HandContacts.right.localPosition));
        rightArm.handRotationOffset.copyFrom(
          new Quaternion(...this.v05HandContacts.right.rotationOffset).normalize(),
        );
      }
      if (leftArm) {
        leftArm.handContactLocal.copyFrom(Vector3.FromArray(this.v05HandContacts.left.localPosition));
        leftArm.handRotationOffset.copyFrom(
          new Quaternion(...this.v05HandContacts.left.rotationOffset).normalize(),
        );
      }
    }
    if (this.v05ShoulderRestRoot) {
      if (rightArm?.shoulderRestRoot && this.v05ShoulderRestRoot.right) {
        rightArm.shoulderRestRoot.copyFrom(this.v05ShoulderRestRoot.right);
      }
      if (leftArm?.shoulderRestRoot && this.v05ShoulderRestRoot.left) {
        leftArm.shoulderRestRoot.copyFrom(this.v05ShoulderRestRoot.left);
      }
    }

    const neutral = neutralSwordRotation(this.fighterForward(root));
    const neutralVisible = neutral.clone().multiply(this.assetWeaponCorrection).normalize();
    root.computeWorldMatrix(true);
    const neutralGripWorld = Vector3.TransformCoordinates(
      this.remoteNeutralGripAnchor,
      root.getWorldMatrix(),
    );
    this.setWeaponRootPoseOn(attachment, attachment.weaponRoot, neutralGripWorld, neutralVisible);
    this.remoteWeaponTarget.setRest(this.remoteNeutralGripAnchor, neutralGripWorld, neutral);
  }

  /**
   * Captures the exported v05 weapon hierarchy without reparenting it. The
   * WeaponRoot transform is the only runtime transform authority; marker
   * children remain authored descendants and are never attached to a hand.
   */
  private captureWeaponAttachment(
    root: TransformNode,
    transformNodes: TransformNode[],
  ): WeaponAttachment | null {
    const weaponRoot = this.findTransformNode("WeaponRoot", transformNodes);
    const reachCenter = this.findTransformNode("ReachCenter", transformNodes);
    const shinai = this.findTransformNode("Shinai", transformNodes);
    const primaryGrip = this.findTransformNode("GripPrimary", transformNodes);
    const secondaryGrip = this.findTransformNode("GripSecondary", transformNodes);
    const bladeBase = this.findTransformNode("BladeBase", transformNodes);
    const bladeTip = this.findTransformNode("BladeTip", transformNodes);
    const bladeUp = this.findTransformNode("BladeUp", transformNodes);
    if (!weaponRoot || !reachCenter || !shinai || !primaryGrip || !secondaryGrip || !bladeBase || !bladeTip || !bladeUp) {
      this.reportError(
        "Weapon attachment unavailable",
        new Error("v05 WeaponRoot, ReachCenter, GripPrimary, GripSecondary, BladeBase, BladeTip, and BladeUp are required"),
      );
      return null;
    }

    root.computeWorldMatrix(true);
    weaponRoot.computeWorldMatrix(true);
    reachCenter.computeWorldMatrix(true);
    shinai.computeWorldMatrix(true);
    primaryGrip.computeWorldMatrix(true);
    secondaryGrip.computeWorldMatrix(true);
    bladeBase.computeWorldMatrix(true);
    bladeTip.computeWorldMatrix(true);
    bladeUp.computeWorldMatrix(true);
    const primaryWorld = primaryGrip.getWorldMatrix().clone();
    const secondaryWorld = secondaryGrip.getWorldMatrix().clone();
    const bladeBaseWorld = bladeBase.getWorldMatrix().clone();
    const bladeTipWorld = bladeTip.getWorldMatrix().clone();
    const bladeUpWorld = bladeUp.getWorldMatrix().clone();
    const secondaryGripWorld = Vector3.TransformCoordinates(Vector3.Zero(), secondaryWorld);
    const primaryGripWorld = Vector3.TransformCoordinates(Vector3.Zero(), primaryWorld);
    const geometry = deriveWeaponGeometry({
      weaponRootWorld: weaponRoot.getWorldMatrix().clone(),
      primaryGripWorld: primaryWorld,
      secondaryGripWorld: secondaryWorld,
      bladeBaseWorld,
      bladeTipWorld,
      bladeUpWorld,
    });
    const frame = deriveWeaponFrame(geometry);
    // GripPrimary is authored inside WeaponRoot. Capture that local offset
    // rather than the marker's position in BAIZHONG_ROOT space; the latter
    // would incorrectly be subtracted again whenever WeaponRoot is posed.
    const weaponRootInverse = Matrix.Invert(weaponRoot.getWorldMatrix());
    const weaponRootToPrimary = Vector3.TransformCoordinates(
      primaryGripWorld,
      weaponRootInverse,
    );
    const rootInverse = Matrix.Invert(root.getWorldMatrix());
    const reachCenterRootLocal = Vector3.TransformCoordinates(
      Vector3.TransformCoordinates(Vector3.Zero(), reachCenter.getWorldMatrix()),
      rootInverse,
    );
    const markersStable = weaponRoot.parent === root &&
      primaryGrip.parent === weaponRoot && secondaryGrip.parent === weaponRoot &&
      bladeBase.parent === weaponRoot && bladeTip.parent === weaponRoot &&
      bladeUp.parent === weaponRoot && shinai.parent === weaponRoot &&
      reachCenter.parent === root;
    if (!markersStable) {
      this.reportError(
        "v05 weapon hierarchy invalid",
        new Error("WeaponRoot/marker parents do not match the exported contract"),
      );
    }

    return {
      weaponRoot,
      shinai,
      primaryGrip,
      secondaryGrip,
      bladeBase,
      bladeTip,
      bladeUp,
      reachCenter,
      frame,
      geometry,
      markersStable,
      primaryGripWorld,
      secondaryGripWorld,
      weaponRootToPrimary,
      reachCenterRootLocal,
    };
  }

  private findTransformNode(name: string, transformNodes: TransformNode[]): TransformNode | null {
    return transformNodes.find((node) => node.name === name) ?? null;
  }

  private setNodeFromMatrix(node: TransformNode, matrix: Matrix): void {
    const scaling = new Vector3();
    const rotation = new Quaternion();
    const position = new Vector3();
    matrix.decompose(scaling, rotation, position);
    node.position.copyFrom(position);
    node.rotationQuaternion = rotation.normalize();
    node.scaling.copyFrom(scaling);
  }

  private rootPointFromWorld(root: TransformNode, pointWorld: Vector3): Vector3 {
    root.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(pointWorld, Matrix.Invert(root.getWorldMatrix()));
  }

  private rootDirectionFromWorld(
    root: TransformNode,
    rotation: Quaternion,
    localAxis: Vector3,
  ): Vector3 {
    const worldDirection = localAxis
      .rotateByQuaternionToRef(rotation, new Vector3())
      .normalize();
    root.computeWorldMatrix(true);
    const inverse = Matrix.Invert(root.getWorldMatrix());
    return Vector3.TransformNormal(worldDirection, inverse).normalize();
  }

  private rootLocalDirectionFromWorld(root: TransformNode, worldDirection: Vector3): Vector3 {
    root.computeWorldMatrix(true);
    return Vector3.TransformNormal(
      worldDirection,
      Matrix.Invert(root.getWorldMatrix()),
    ).normalize();
  }

  /**
   * Positions WeaponRoot so its authored GripPrimary marker lands at the
   * requested world point while its authored frame follows the desired pose.
   */
  private setWeaponRootPose(primaryWorld: Vector3, visibleRotation: Quaternion): void {
    this.setWeaponRootPoseOn(
      this.weaponAttachment,
      this.weaponRoot,
      primaryWorld,
      visibleRotation,
    );
  }

  private setWeaponRootPoseOn(
    attachment: WeaponAttachment | null,
    root: TransformNode | null,
    primaryWorld: Vector3,
    visibleRotation: Quaternion,
  ): void {
    if (!attachment || !root) return;
    const rootOriginWorld = primaryWorld.subtract(
      attachment.weaponRootToPrimary
        .rotateByQuaternionToRef(visibleRotation, new Vector3()),
    );
    const desiredWorld = Matrix.Compose(Vector3.One(), visibleRotation, rootOriginWorld);
    const parentWorld = root.parent
      ? (root.parent as TransformNode).getWorldMatrix()
      : Matrix.Identity();
    const local = desiredWorld.multiply(Matrix.Invert(parentWorld));
    this.setNodeFromMatrix(root, local);
    root.computeWorldMatrix(true);
  }

  /** glTF's Y-up conversion maps the v05 Blender -Y front to runtime +Z. */
  private fighterForward(root: TransformNode): Vector3 {
    return root.getDirection(Vector3.Forward()).normalize();
  }

  /**
   * Carries the neutral sword frame across the circle's forward hemisphere.
   * Center points forward; the top rim points exactly up while retaining a
   * stable roll frame for the two-hand IK solver.
   */
  private circularWeaponRotation(
    forwardInput: Vector3,
    rightInput: Vector3,
    point: CirclePoint,
  ): Quaternion {
    const forward = forwardInput.clone().normalize();
    const right = rightInput.clone().normalize();
    const weights = circleDirectionWeights(point);
    const direction = forward.scale(weights.forward)
      .add(right.scale(weights.lateral))
      .add(Vector3.Up().scale(weights.vertical))
      .normalize();

    const cross = Vector3.Cross(forward, direction);
    const dot = Math.max(-1, Math.min(1, Vector3.Dot(forward, direction)));
    const swing = cross.lengthSquared() > 1e-10
      ? Quaternion.RotationAxis(cross.normalize(), Math.acos(dot))
      : Quaternion.Identity();
    const bladeRight = right.rotateByQuaternionToRef(swing, new Vector3()).normalize();
    const bladeUp = Vector3.Cross(bladeRight, direction).normalize();
    return Quaternion.RotationQuaternionFromAxis(bladeRight, direction, bladeUp).normalize();
  }

  /** Returns the gameplay forward axis after v05 marker correction. */
  private gameplayBladeForwardAxis(): Vector3 {
    return this.gameplayGeometry?.bladeForward.clone().normalize() ??
      GAMEPLAY_BLADE_FORWARD_AXIS.clone();
  }

  private createArmRig(
    root: TransformNode,
    side: "right" | "left",
    skeleton: Skeleton,
    skeletonMesh: TransformNode,
    shoulder: Bone | null,
    upperArm: Bone | null,
    forearm: Bone | null,
    hand: Bone | null,
  ): ArmRig | null {
    if (!shoulder || !upperArm || !forearm || !hand) {
      this.reportError(
        `${side} arm IK unavailable`,
        new Error(`Missing ${side} shoulder/upper-arm/forearm/hand bones`),
      );
      return null;
    }

    skeleton.computeAbsoluteMatrices(true);
    const upperPosition = upperArm.getAbsolutePosition(skeletonMesh);
    const elbowPosition = forearm.getAbsolutePosition(skeletonMesh);
    const handPosition = hand.getAbsolutePosition(skeletonMesh);
    const animatedUpperArmNode = upperArm.getTransformNode();
    const animatedForearmNode = forearm.getTransformNode();
    const animatedHandNode = hand.getTransformNode();
    // glTF imports commonly link bones to transform nodes. Keep those nodes
    // as animation inputs, but detach the procedural IK chain so
    // Skeleton.prepare() cannot overwrite the solved rotations before draw.
    upperArm.linkTransformNode(null);
    forearm.linkTransformNode(null);
    hand.linkTransformNode(null);
    root.computeWorldMatrix(true);
    // The v05 manifest's shoulderJointRest measurement is the upper-arm
    // joint (the origin used by the two-bone chain), not the separate
    // clavicle/shoulder display bone. Capture that rest-space joint once so
    // authoritative reach checks stay aligned with presentation IK even
    // after an animation moves the live skeleton.
    const restCaptureRoot = Vector3.TransformCoordinates(
      upperPosition,
      Matrix.Invert(root.getWorldMatrix()),
    );
    const firstLength = Math.max(upperPosition.subtract(elbowPosition).length(), 0.08);
    const secondLength = Math.max(elbowPosition.subtract(handPosition).length(), 0.08);
    const targetNode = new TransformNode(`weapon-${side}-hand-target`, this.scene);
    const poleNode = new TransformNode(`weapon-${side}-elbow-pole`, this.scene);
    const controller = new BoneIKController(skeletonMesh, forearm, {
      targetMesh: targetNode,
      poleTargetMesh: poleNode,
      bendAxis: Vector3.Forward(),
      maxAngle: Math.PI - 0.18,
      slerpAmount: 1,
    });

    return {
      side,
      shoulder,
      upperArm,
      forearm,
      hand,
      controller,
      targetNode,
      poleNode,
      firstLength,
      secondLength,
      // Replaced with the manifest-authored v04 gripping-frame correction
      // before the first authoritative solve.
      handRotationOffset: Quaternion.Identity(),
      handContactLocal: Vector3.Zero(),
      restCaptureRoot,
      shoulderRestRoot: restCaptureRoot.clone(),
      animatedUpperArmNode,
      animatedForearmNode,
      animatedHandNode,
      origin: upperPosition.clone(),
      target: handPosition.clone(),
      pole: upperPosition.clone(),
      contact: handPosition.clone(),
      gripErrorMeters: Number.POSITIVE_INFINITY,
      clamped: false,
      finite: true,
    };
  }

  private findRoot(transformNodes: TransformNode[], meshes: AbstractMesh[]): TransformNode {
    return (
      transformNodes.find((node) => node.name === "BAIZHONG_ROOT") ??
      meshes.find((mesh) => mesh.name === "BAIZHONG_ROOT") ??
      transformNodes[0] ??
      meshes[0]
    );
  }

  private findBone(skeleton: Skeleton, name: string): Bone | null {
    return skeleton.bones.find((bone) => bone.name === name) ?? null;
  }

  private inspectWeaponNodes(
    transformNodes: TransformNode[],
    meshes: AbstractMesh[],
    skeletons: Skeleton[],
  ): Record<string, boolean> {
    const available = new Set([
      ...transformNodes.map((node) => node.name),
      ...meshes.map((mesh) => mesh.name),
      ...skeletons.flatMap((skeleton) => skeleton.bones.map((bone) => bone.name)),
    ]);
    const report = Object.fromEntries(WEAPON_NODE_NAMES.map((name) => [name, available.has(name)]));
    const missing = WEAPON_NODE_NAMES.filter((name) => !report[name]);
    if (missing.length > 0) {
      console.warn("[Chambara] Missing weapon/hand nodes:", missing.join(", "));
    }
    console.info(
      "[Chambara] Weapon hierarchy:",
      WEAPON_NODE_NAMES.map((name) => `${name}=${report[name] ? "found" : "missing"}`).join(" "),
    );
    return report;
  }

  private resetSimulatedInputState(): void {
    this.resetCircleSword();
    this.latestControllerState = null;
    this.latchedControllerState = null;
    this.simulatedSequence = 0;
    const simulated = this.simulatedMotionMode !== null;
    this.status.motion.source = simulated ? "simulation" : "none";
    this.status.motion.streamState = simulated ? "live" : "idle";
    this.status.motion.samplesPerSecond = simulated ? 60 : 0;
    this.status.motion.sessionGeneration = simulated ? 0 : null;
    this.status.motion.lastSequence = null;
    this.status.motion.sampleAgeMs = null;
    this.status.motion.calibrated = simulated;
    this.status.motion.quaternion = null;
    this.status.motion.rawDeviceQuaternion = null;
    this.status.motion.calibrationReferenceQuaternion = simulated
      ? [0, 0, 0, 1]
      : null;
    this.status.motion.relativeQuaternion = null;
    this.status.motion.mappedGameQuaternion = null;
    this.status.motion.weaponControlEnabled = false;
  }

  private simulationStep(dt: number): void {
    this.simulationTicks += 1;
    const reachAlpha = 1 - Math.exp(-REACH_SHELL_DAMPING * Math.max(dt, 0));
    this.reachFraction += (this.targetReachFraction - this.reachFraction) * reachAlpha;
    if (Math.abs(this.targetReachFraction - this.reachFraction) < 0.002) {
      this.reachFraction = this.targetReachFraction;
      this.poseState = this.targetPoseState;
    }
    this.status.motion.poseState = this.poseState;
    this.status.motion.targetPoseState = this.targetPoseState;
    this.status.motion.reachFraction = this.reachFraction;

    if (this.duelSessionActive && !this.matchFrozen) {
      const phaseSnap = this.matchPhase.tick(dt);
      if (phaseSnap) {
        this.playerCombatX = phaseSnap.playerX;
        this.dummyCombatX = phaseSnap.dummyX;
        this.applyCombatSeats();
        if (phaseSnap.phase === "WalkIn" || phaseSnap.phase === "Fighting") {
          this.rebindWeaponAfterSeatChange();
        }
      }
    }
    this.syncLocalStunPresentation();

    // Slash step → lunge seats → refresh tip on lunged root → hit resolve.
    this.driveControllerMotion(dt);
    this.updateMatchCombatMotion(dt);
    this.refreshWeaponTipForCombatSeats();
    if (!this.matchCombatActive) {
      const solo = this.tickSoloDummyCombat();
      if (solo) this.applyCombatOutcome(solo);
    } else if (this.matchIsHost && !this.pendingHostCombatOutcome) {
      // Same ordering as solo: resolve only after tip is on lunged seats.
      const resolved = this.tryHostResolveCombat();
      if (resolved) this.pendingHostCombatOutcome = resolved;
    }
  }

  private driveControllerMotion(dt: number): void {
    const now = performance.now();

    if (this.simulatedMotionMode !== null) {
      const phoneQuaternion = this.simulatedMotionMode === "continuous"
        ? simulatedOrientation(this.simulationTicks * SIM_DT)
        : simulatedPhonePose(this.simulatedMotionMode, Math.PI / 2);
      const simulatedSample: ControllerSample = {
        sequence: this.simulatedSequence,
        sessionGeneration: 0,
        timestamp: Date.now(),
        quaternion: quaternionToTuple(phoneQuaternion),
        rawQuaternion: quaternionToTuple(phoneQuaternion),
        calibrationReferenceQuaternion: [0, 0, 0, 1],
        calibrated: true,
        source: "simulation",
      };
      this.simulatedSequence += 1;
      this.latestControllerState = simulatedSample;
      this.latestControllerReceivedAt = now;
    }

    this.latchedControllerState = this.latestControllerState;
    const sample = this.latchedControllerState;
    if (!sample) {
      this.resetCircleSword();
      this.status.motion.streamState = "idle";
      this.status.motion.weaponControlEnabled = false;
      if (this.simulatedMotionMode === null) this.status.motion.source = "none";
      this.updateRestWeaponTarget();
      this.updateRemoteWeaponTarget(dt);
      return;
    }

    const age = Math.max(0, now - this.latestControllerReceivedAt);
    this.status.motion.source = sample.source;
    this.status.motion.sessionGeneration = sample.sessionGeneration;
    this.status.motion.lastSequence = sample.sequence;
    this.status.motion.sampleAgeMs = Math.round(age);
    this.status.motion.calibrated = sample.calibrated;
    this.status.motion.quaternion = [...sample.quaternion] as QuaternionTuple;
    this.status.motion.relativeQuaternion = [...sample.quaternion] as QuaternionTuple;
    this.status.motion.rawDeviceQuaternion = sample.rawQuaternion
      ? ([...sample.rawQuaternion] as QuaternionTuple)
      : ([...sample.quaternion] as QuaternionTuple);
    this.status.motion.calibrationReferenceQuaternion = sample.calibrationReferenceQuaternion
      ? ([...sample.calibrationReferenceQuaternion] as QuaternionTuple)
      : sample.source === "simulation"
        ? [0, 0, 0, 1]
        : null;

    if (age > MOTION_STALE_MS || (sample.source === "phone" && !this.status.motion.peerConnected)) {
      this.resetCircleSword();
      this.status.motion.streamState = "stale";
      this.status.motion.weaponControlEnabled = false;
      this.updateRestWeaponTarget();
      this.updateRemoteWeaponTarget(dt);
      return;
    }
    if (!sample.calibrated) {
      this.resetCircleSword();
      this.status.motion.streamState = "waiting";
      this.status.motion.weaponControlEnabled = false;
      this.updateRestWeaponTarget();
      this.updateRemoteWeaponTarget(dt);
      return;
    }

    this.status.motion.streamState = "live";
    this.updateWeaponTarget(sample, dt);
    this.status.motion.weaponControlEnabled = true;
    this.updateRemoteWeaponTarget(dt);
  }

  /**
   * Re-solves grip/tip after duel-axis seats move (lunge/knockback) without
   * advancing CircleSword again.
   */
  private refreshWeaponTipForCombatSeats(): void {
    if (!this.poseRig || !this.status.motion.weaponControlEnabled) return;
    if (this.status.motion.streamState !== "live") return;
    const sample = this.latchedControllerState;
    if (!sample?.calibrated) return;
    const blend = this.blockBlend;
    const neutralRotation = this.computeGameplayNeutralWeaponRotation();
    const root = this.poseRig.root;
    const forward = this.fighterForward(root);
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();
    const { x, y } = this.circleSword.point;
    const slashing = blend < 0.05 && this.circleSword.phase === "slashing";
    const readyDir = forward
      .scale(slashing ? 1.2 : 0.85)
      .add(right.scale(x * (slashing ? 0.45 : 0.7)))
      .add(Vector3.Up().scale(y * (slashing ? 0.4 : 0.7)))
      .normalize();
    const blockDir = blockBladeDirection(right, forward, x);
    const blended = nlerpBladeDirection(
      { x: readyDir.x, y: readyDir.y, z: readyDir.z },
      blockDir,
      blend,
    );
    const bladeDirection = new Vector3(blended.x, blended.y, blended.z);
    const targetWorldRotation = blend < 0.05
      ? this.circularWeaponRotation(forward, right, { x, y })
      : neutralSwordRotation(bladeDirection);
    const extension =
      (slashing ? 0.22 + 0.12 * (1 - Math.hypot(x, y)) : 0) * (1 - blend);
    const guardOffset = lerpGuardOffsets(
      guardPoseOffsets({ x, y }),
      blockGuardPoseOffsets({ x, y }),
      blend,
    );
    const guardGrip = this.rootRelativeAnchorToWorld(root)
      .add(right.scale(guardOffset.lateral))
      .add(Vector3.Up().scale(guardOffset.vertical))
      .add(forward.scale(guardOffset.forward + extension));
    const worldGrip = this.fitGripToArmReach(guardGrip, targetWorldRotation);
    const rootAnchor = this.rootPointFromWorld(root, worldGrip);
    this.weaponTarget.setController(
      rootAnchor,
      worldGrip,
      targetWorldRotation,
      sample.sessionGeneration,
      sample.sequence,
    );
    this.syncWeaponTargetStatus();
  }

  private updateMatchCombatMotion(dt: number): void {
    if (!this.player || !this.dummy) return;
    if (this.matchFrozen) return;

    if (!this.isCombatOpen()) {
      this.applyCombatSeats();
      const playerX = this.playerCombatX;
      const dummyX = this.dummyCombatX;
      this.player.root.rotationQuaternion = Quaternion.RotationAxis(
        Vector3.Up(),
        faceYawRadians(playerX, dummyX),
      );
      this.dummy.root.rotationQuaternion = Quaternion.RotationAxis(
        Vector3.Up(),
        faceYawRadians(dummyX, playerX),
      );
      return;
    }

    // Mid-slash lunge + miss recover. Lunge must run even while regrouping —
    // otherwise post-hit swings stay out of blade reach.
    if (this.lungeActive && !this.lungeHitConnected) {
      const phase = this.circleSword.phase;
      if (phase === "slashing") {
        // Pause seat regroup so the attacker can close for the cut.
        this.regroupTarget = null;
        const factor = lungeFactorFromSlashProgress(this.circleSword.slashProgress);
        this.playerCombatX = lungeTargetX(
          this.lungeOriginX,
          this.dummyCombatX,
          factor,
        );
      } else if (
        this.prevSwordPhase === "slashing" &&
        (phase === "recovering" || phase === "aiming")
      ) {
        this.lungeActive = false;
        this.lungeRecovering = true;
      }
    }
    if (this.lungeRecovering && !this.lungeHitConnected) {
      this.playerCombatX = stepLungeRecover(this.playerCombatX, this.lungeOriginX, dt);
      if (Math.abs(this.playerCombatX - this.lungeOriginX) < 0.01) {
        this.playerCombatX = this.lungeOriginX;
        this.lungeRecovering = false;
      }
    }
    this.prevSwordPhase = this.circleSword.phase;

    // Remote (dummy-seat) lunge mirrors local close so PvP reach works at preferred spacing.
    if (this.remoteLungeActive && !this.remoteLungeHitConnected) {
      const now = performance.now();
      const remoteProgress = this.estimateRemoteSlashProgress(now);
      if (remoteProgress !== null) {
        this.regroupTarget = null;
        const factor = lungeFactorFromSlashProgress(remoteProgress);
        this.dummyCombatX = lungeTargetX(
          this.remoteLungeOriginX,
          this.playerCombatX,
          factor,
        );
      } else if (this.remoteSlashStartedAt !== null) {
        const elapsed =
          (now - this.remoteSlashStartedAt) / (CUT_SECONDS * 1000);
        if (elapsed > 1) {
          this.remoteLungeActive = false;
          this.remoteLungeRecovering = true;
        }
      }
    }
    if (this.remoteLungeRecovering && !this.remoteLungeHitConnected) {
      this.dummyCombatX = stepLungeRecover(
        this.dummyCombatX,
        this.remoteLungeOriginX,
        dt,
      );
      if (Math.abs(this.dummyCombatX - this.remoteLungeOriginX) < 0.01) {
        this.dummyCombatX = this.remoteLungeOriginX;
        this.remoteLungeRecovering = false;
      }
    }

    if (
      this.regroupTarget &&
      !this.lungeActive &&
      !this.lungeRecovering &&
      !this.remoteLungeActive &&
      !this.remoteLungeRecovering
    ) {
      const next = stepRegroup(
        {
          playerX: this.playerCombatX,
          dummyX: this.dummyCombatX,
        },
        this.regroupTarget,
        dt,
      );
      this.playerCombatX = next.playerX;
      this.dummyCombatX = next.dummyX;
      const close =
        Math.abs(next.playerX - this.regroupTarget.playerX) < 0.01 &&
        Math.abs(next.dummyX - this.regroupTarget.dummyX) < 0.01;
      if (close) this.regroupTarget = null;
    }

    this.applyCombatSeats();
    const playerX = this.playerCombatX;
    const dummyX = this.dummyCombatX;
    this.player.root.rotationQuaternion = Quaternion.RotationAxis(
      Vector3.Up(),
      faceYawRadians(playerX, dummyX),
    );
    this.dummy.root.rotationQuaternion = Quaternion.RotationAxis(
      Vector3.Up(),
      faceYawRadians(dummyX, playerX),
    );
  }

  private updateRemoteWeaponTarget(_dt: number): void {
    if (!this.remoteActive || !this.latestRemoteNetworkPose || !this.remotePoseRig || !this.gameplayGeometry) {
      return;
    }
    const pose = this.latestRemoteNetworkPose;
    const mapped = this.mapPublisherPlayerPoseToLocalDummy(
      Vector3.FromArray(pose.position),
      tupleToQuaternion(pose.rotation),
    );
    const root = this.remotePoseRig.root;
    const rootAnchor = this.rootPointFromWorld(root, mapped.position);
    this.remoteWeaponTarget.setController(
      rootAnchor,
      mapped.position,
      mapped.rotation,
      pose.sessionGeneration,
      pose.sequence,
    );
  }

  /**
   * Publisher writes GripPrimary in their local-player world frame. Each client
   * views itself on the left seat, so remap into the right-hand dummy seat.
   */
  private mapPublisherPlayerPoseToLocalDummy(
    position: Vector3,
    rotation: Quaternion,
  ): { position: Vector3; rotation: Quaternion } {
    const publisherRoot = Matrix.Compose(
      Vector3.One(),
      Quaternion.RotationAxis(Vector3.Up(), LOCAL_PLAYER_ROTATION_Y),
      new Vector3(this.playerCombatX, 0, 0),
    );
    const localDummyRoot = Matrix.Compose(
      Vector3.One(),
      Quaternion.RotationAxis(Vector3.Up(), REMOTE_DUMMY_ROTATION_Y),
      new Vector3(this.dummyCombatX, 0, 0),
    );
    const gripLocal = Vector3.TransformCoordinates(position, Matrix.Invert(publisherRoot));
    const mappedPosition = Vector3.TransformCoordinates(gripLocal, localDummyRoot);

    const publisherRot = Quaternion.RotationAxis(Vector3.Up(), LOCAL_PLAYER_ROTATION_Y);
    const dummyRot = Quaternion.RotationAxis(Vector3.Up(), REMOTE_DUMMY_ROTATION_Y);
    const relative = publisherRot.invert().multiply(rotation).normalize();
    const mappedRotation = dummyRot.multiply(relative).normalize();
    return { position: mappedPosition, rotation: mappedRotation };
  }

  private updateRestWeaponTarget(): void {
    if (!this.poseRig) return;
    const neutralRotation = this.computeGameplayNeutralWeaponRotation();
    const worldGrip = this.solveShellGrip(this.poseRig.root, neutralRotation);
    const rootAnchor = this.rootPointFromWorld(this.poseRig.root, worldGrip);
    this.weaponTarget.setRest(rootAnchor, worldGrip, neutralRotation);
    this.status.motion.mappedGameQuaternion = quaternionToTuple(Quaternion.Identity());
    this.syncWeaponTargetStatus();
  }

  private updateWeaponTarget(sample: ControllerSample, dt: number): void {
    if (!this.poseRig) return;
    const blocking = sample.blocking === true;
    this.phoneBlocking = blocking;
    const neutralRotation = this.computeGameplayNeutralWeaponRotation();
    const phoneDelta = tupleToQuaternion(sample.quaternion);
    const gameDelta = phoneDeltaToGameDelta(phoneDelta, this.phoneToGameplayBasis);
    const root = this.poseRig.root;
    const forward = this.fighterForward(root);
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();
    const inputRotation = neutralRotation.clone().multiply(gameDelta).normalize();
    const inputForward = this.gameplayBladeForwardAxis().rotateByQuaternionToRef(inputRotation, new Vector3());
    const session = `${sample.source}:${sample.sessionGeneration}:${sample.calibrationReferenceQuaternion?.join(",")}`;
    if (session !== this.circleSession) {
      this.resetCircleSword();
      this.circleSession = session;
      this.lastSlashCount = sample.slashCount ?? 0;
    }
    const aimX = Vector3.Dot(inputForward, right);
    // While blocking: circle X free, Y forced high so guard angle is lateral-only.
    this.circleSword.aim(aimX, blocking ? BLOCK_AIM_Y : inputForward.y);
    const slashCount = sample.slashCount ?? 0;
    const stunned =
      this.matchFrozen ||
      !this.isCombatOpen() ||
      performance.now() < this.localStunUntil;
    if (slashCount > this.lastSlashCount) {
      // Probe slash() only when we might arm; blocking/stun skips the call.
      const slashAccepted =
        !blocking && !stunned ? this.circleSword.slash() : false;
      const arming = advanceSlashArming({
        slashCount,
        lastSlashCount: this.lastSlashCount,
        blocking,
        stunned,
        slashAccepted,
      });
      this.lastSlashCount = arming.lastSlashCount;
      if (arming.armed) {
        this.localSlashSeq += 1;
        this.remoteBlockLatchForLocalSlash = this.remoteIntent?.blocking === true;
        this.beginAttackLunge();
      }
    }
    this.circleSword.step(dt);
    const { x, y } = this.circleSword.point;
    this.status.motion.swordPhase = this.circleSword.phase;
    this.status.motion.guardX = x;
    this.status.motion.guardY = y;
    this.status.motion.blocking = blocking;
    this.blockBlend = approachBlockBlend(this.blockBlend, blocking, dt);
    const blend = this.blockBlend;

    const reachState =
      this.circleSword.phase === "slashing"
        ? "ATTACK_ACTIVE"
        : this.circleSword.phase === "recovering"
          ? "ATTACK_RECOVERY"
          : "READY";
    const readyReach = POSE_REACH_FRACTIONS[reachState];
    const blockReach = POSE_REACH_FRACTIONS.BLOCK;
    this.targetReachFraction = readyReach + (blockReach - readyReach) * blend;
    if (blend >= 0.5) {
      this.targetPoseState = "BLOCK";
      this.status.motion.targetPoseState = "BLOCK";
      this.syncBlockAnimation(x);
    } else {
      this.targetPoseState = reachState;
      this.status.motion.targetPoseState = reachState;
      if (blend < 0.05 && this.lastBlockAnimation) this.clearBlockAnimation();
    }
    // Translate the grip as well as orienting the blade: both hands travel
    // through guard poses and across the cut via the existing contact-aware IK.
    // Block blend: nlerp tip-up / ±90° with ready/slash aim.
    const slashing = blend < 0.05 && this.circleSword.phase === "slashing";
    const readyDir = forward
      .scale(slashing ? 1.2 : 0.85)
      .add(right.scale(x * (slashing ? 0.45 : 0.7)))
      .add(Vector3.Up().scale(y * (slashing ? 0.4 : 0.7)))
      .normalize();
    const blockDir = blockBladeDirection(right, forward, x);
    const blended = nlerpBladeDirection(
      { x: readyDir.x, y: readyDir.y, z: readyDir.z },
      blockDir,
      blend,
    );
    const bladeDirection = new Vector3(blended.x, blended.y, blended.z);
    const targetWorldRotation = blend < 0.05
      ? this.circularWeaponRotation(forward, right, { x, y })
      : neutralSwordRotation(bladeDirection);
    const extension =
      (slashing ? 0.22 + 0.12 * (1 - Math.hypot(x, y)) : 0) * (1 - blend);
    const guardOffset = lerpGuardOffsets(
      guardPoseOffsets({ x, y }),
      blockGuardPoseOffsets({ x, y }),
      blend,
    );
    const guardGrip = this.rootRelativeAnchorToWorld(root)
      .add(right.scale(guardOffset.lateral))
      .add(Vector3.Up().scale(guardOffset.vertical))
      .add(forward.scale(guardOffset.forward + extension));
    const worldGrip = this.fitGripToArmReach(guardGrip, targetWorldRotation);
    const center = Vector3.TransformCoordinates(this.reachCenterRootLocal, root.getWorldMatrix());
    this.status.motion.reachCenterWorld = vectorTuple(center);
    this.shellRadiusMeters = Vector3.Distance(center, worldGrip);
    this.status.motion.reachShellRadiusMeters = this.shellRadiusMeters;
    this.status.motion.twoArmFeasible = this.checkTwoArmFeasibility(worldGrip, targetWorldRotation);
    this.status.motion.reachAdjusted = Vector3.Distance(worldGrip, guardGrip) > 0.001;
    const rootAnchor = this.rootPointFromWorld(this.poseRig.root, worldGrip);
    this.status.motion.mappedGameQuaternion = quaternionToTuple(gameDelta);
    this.weaponTarget.setController(
      rootAnchor,
      worldGrip,
      targetWorldRotation,
      sample.sessionGeneration,
      sample.sequence,
    );
    this.syncWeaponTargetStatus();
  }

  private static readonly BLOCK_CLIP_SPEED = 0.25;

  private syncBlockAnimation(guardX: number): void {
    const name =
      Math.abs(guardX) < 0.28 ? "BlockIdle" : guardX < 0 ? "BlockSideLeft" : "BlockSideRight";
    if (this.lastBlockAnimation === name) return;
    if (this.playAnimation(name, { speed: BabylonGame.BLOCK_CLIP_SPEED })) {
      this.lastBlockAnimation = name;
    }
  }

  private clearBlockAnimation(): void {
    if (!this.lastBlockAnimation) return;
    this.lastBlockAnimation = "";
    this.player?.controller.reset();
  }

  private computeGameplayNeutralWeaponRotation(): Quaternion {
    if (!this.poseRig) return this.gameplayNeutralWeaponRotation;
    const forward = this.fighterForward(this.poseRig.root);
    this.gameplayNeutralWeaponRotation = neutralSwordRotation(forward);
    this.status.motion.neutralWeaponQuaternion = quaternionToTuple(
      this.gameplayNeutralWeaponRotation,
    );
    return this.gameplayNeutralWeaponRotation;
  }

  private rootRelativeAnchorToWorld(root: TransformNode): Vector3 {
    root.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(this.neutralGripAnchor, root.getWorldMatrix());
  }

  private solveShellGrip(root: TransformNode, gameplayRotation: Quaternion): Vector3 {
    root.computeWorldMatrix(true);
    const center = Vector3.TransformCoordinates(this.reachCenterRootLocal, root.getWorldMatrix());
    const desiredForwardWorld = this.gameplayBladeForwardAxis()
      .rotateByQuaternionToRef(gameplayRotation, new Vector3())
      .normalize();
    const desiredForwardRoot = this.rootPointFromWorld(root, center.add(desiredForwardWorld))
      .subtract(this.reachCenterRootLocal)
      .normalize();
    const shellForward = Vector3.Lerp(
      this.neutralForwardRoot,
      desiredForwardRoot,
      SHELL_TRANSLATION_SWING,
    ).normalize();
    const requestedRadius = this.shellBaseRadiusMeters > 0
      ? this.shellBaseRadiusMeters * this.reachFraction
      : this.shellRadiusMeters;
    let radius = requestedRadius;
    let rootGrip = this.neutralGripAnchor.clone();
    let feasible = false;
    const authoredRadius = this.neutralGripAnchor
      .subtract(this.reachCenterRootLocal)
      .length();
    // Keep a generous fraction of the authored v05 ready stance as the hard
    // floor. This prevents a bad pole/coordinate estimate from collapsing the
    // weapon into the chest while still preserving two-arm feasibility.
    const minimumRadius = Math.max(authoredRadius * 0.55, 0.12);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      rootGrip = solveSphericalShellPosition(
        this.reachCenterRootLocal,
        this.neutralGripAnchor,
        this.neutralForwardRoot,
        shellForward,
        radius,
      );
      const shellWorldGrip = Vector3.TransformCoordinates(rootGrip, root.getWorldMatrix());
      const fittedWorldGrip = this.fitGripToArmReach(shellWorldGrip, gameplayRotation);
      rootGrip = this.rootPointFromWorld(root, fittedWorldGrip);
      feasible = this.checkTwoArmFeasibility(fittedWorldGrip, gameplayRotation);
      if (feasible || radius <= minimumRadius) break;
      radius = Math.max(minimumRadius, radius * 0.92);
    }
    this.shellRadiusMeters = radius;
    this.status.motion.reachShellRadiusMeters = radius;
    this.status.motion.twoArmFeasible = feasible;
    this.status.motion.reachAdjusted = radius + 1e-5 < requestedRadius;
    const worldGrip = Vector3.TransformCoordinates(rootGrip, root.getWorldMatrix());
    this.status.motion.reachCenterWorld = vectorTuple(center);
    return worldGrip;
  }

  private fitGripToArmReach(gripInput: Vector3, gameplayRotation: Quaternion): Vector3 {
    if (!this.poseRig || !this.gameplayGeometry) return gripInput;
    const visibleRotation = gameplayRotation
      .clone()
      .multiply(this.assetWeaponCorrection)
      .normalize();
    const grip = gripInput.clone();
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const points = deriveWeaponPosePoints(grip, gameplayRotation, this.gameplayGeometry);
      const checks: Array<[ArmRig | null, Vector3]> = [
        [this.poseRig.rightArm, points.primaryHandTarget],
        [this.poseRig.leftArm, points.secondaryHandTarget],
      ];
      const correction = Vector3.Zero();
      for (const [arm, target] of checks) {
        if (!arm) continue;
        // GripPrimary/GripSecondary are authoritative. The v04-authored
        // contact point converts each marker target into a wrist target, while
        // feasibility uses a stable rest shoulder rather than live animation.
        const desiredHandRotation = this.desiredHandRotation(arm, visibleRotation);
        const wrist = deriveWristTargetFromGrip(
          target,
          desiredHandRotation,
          arm.handContactLocal,
        );
        const origin = this.stableShoulderWorld(arm);
        const delta = wrist.subtract(origin);
        const distance = delta.length();
        const max = arm.firstLength + arm.secondLength - 0.01;
        const min = Math.abs(arm.firstLength - arm.secondLength) + 0.01;
        if (distance > max) {
          correction.addInPlace(delta.scale((max - distance) / Math.max(distance, 1e-6)));
        } else if (distance < min) {
          correction.addInPlace(delta.scale((min - distance) / Math.max(distance, 1e-6)));
        }
      }
      if (correction.length() < 0.001) break;
      grip.addInPlace(correction.scale(0.7));
    }
    return grip;
  }

  private checkTwoArmFeasibility(grip: Vector3, gameplayRotation: Quaternion): boolean {
    if (!this.poseRig || !this.gameplayGeometry) return true;
    const points = deriveWeaponPosePoints(grip, gameplayRotation, this.gameplayGeometry);
    const visibleRotation = gameplayRotation
      .clone()
      .multiply(this.assetWeaponCorrection)
      .normalize();
    const checks: Array<[ArmRig | null, Vector3]> = [
      [this.poseRig.rightArm, points.primaryHandTarget],
      [this.poseRig.leftArm, points.secondaryHandTarget],
    ];
    const distances = checks.map(([arm, target]) => {
      if (!arm) return { feasible: false, distance: Number.NaN };
      const desiredHandRotation = this.desiredHandRotation(arm, visibleRotation);
      const wrist = deriveWristTargetFromGrip(
        target,
        desiredHandRotation,
        arm.handContactLocal,
      );
      const origin = this.stableShoulderWorld(arm);
      const distance = wrist.subtract(origin).length();
      const minimum = Math.abs(arm.firstLength - arm.secondLength) + 0.01;
      const maximum = arm.firstLength + arm.secondLength - 0.01;
      return {
        feasible: Number.isFinite(distance) && distance >= minimum && distance <= maximum,
        distance,
      };
    });
    const feasible = distances.every((entry) => entry.feasible);
    return feasible;
  }

  private syncWeaponTargetStatus(): void {
    const snapshot = this.weaponTarget.snapshot();
    this.status.motion.weaponTargetSource = snapshot.source;
    this.status.motion.weaponTargetRootAnchor = snapshot.rootRelativeGripAnchor;
    this.status.motion.weaponTargetPosition = snapshot.worldPosition;
    this.status.motion.weaponTargetQuaternion = snapshot.worldRotation;
    this.status.motion.gameplayWeaponQuaternion = snapshot.worldRotation;
    this.status.motion.weaponTargetBase = snapshot.swordBase;
    this.status.motion.weaponTargetTip = snapshot.swordTip;
    this.status.motion.weaponTargetSessionGeneration = snapshot.sessionGeneration;
    this.status.motion.weaponTargetSequence = snapshot.sequence;
  }

  /**
   * Promotes the manifest's authored shoulder joints to gameplay anchors.
   * The skeleton capture is retained only for a validation comparison and as
   * the explicit fallback when older/malformed manifests omit the values.
   */
  private applyManifestShoulderAnchors(): void {
    if (!this.poseRig) return;
    const rightArm = this.poseRig.rightArm;
    const leftArm = this.poseRig.leftArm;
    const manifest = this.v05ShoulderRestRoot;
    const manifestAvailable = Boolean(manifest?.right && manifest?.left);

    if (rightArm) {
      this.status.motion.rightShoulderRestCaptureRoot = vectorTuple(rightArm.restCaptureRoot);
      if (manifest?.right) {
        rightArm.shoulderRestRoot.copyFrom(manifest.right);
        this.status.motion.rightShoulderAnchorErrorMeters = rightArm.shoulderRestRoot
          .subtract(rightArm.restCaptureRoot)
          .length();
      } else {
        rightArm.shoulderRestRoot.copyFrom(rightArm.restCaptureRoot);
        this.status.motion.rightShoulderAnchorErrorMeters = null;
      }
      this.status.motion.rightShoulderRestRoot = vectorTuple(rightArm.shoulderRestRoot);
    }

    if (leftArm) {
      this.status.motion.leftShoulderRestCaptureRoot = vectorTuple(leftArm.restCaptureRoot);
      if (manifest?.left) {
        leftArm.shoulderRestRoot.copyFrom(manifest.left);
        this.status.motion.leftShoulderAnchorErrorMeters = leftArm.shoulderRestRoot
          .subtract(leftArm.restCaptureRoot)
          .length();
      } else {
        leftArm.shoulderRestRoot.copyFrom(leftArm.restCaptureRoot);
        this.status.motion.leftShoulderAnchorErrorMeters = null;
      }
      this.status.motion.leftShoulderRestRoot = vectorTuple(leftArm.shoulderRestRoot);
    }

    this.status.motion.shoulderAnchorSource = manifestAvailable && rightArm && leftArm
      ? "manifest"
      : rightArm && leftArm
        ? "rest-capture"
        : "unavailable";
  }

  /**
   * Returns the stable rest shoulder in world space. Authoritative shell
   * feasibility calls this before presentation IK and therefore never reads
   * a shoulder that an animation clip may have moved.
   */
  private stableShoulderWorld(arm: ArmRig, rootOverride: TransformNode | null = null): Vector3 {
    const root = rootOverride ?? this.poseRig?.root;
    if (!root) return arm.shoulderRestRoot.clone();
    root.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(arm.shoulderRestRoot, root.getWorldMatrix());
  }

  private desiredHandRotation(arm: ArmRig, weaponRotation: Quaternion): Quaternion {
    return weaponRotation.clone().multiply(arm.handRotationOffset).normalize();
  }

  /** Applies the v04-authored contact frame stored in the v05 manifest. */
  private applyManifestHandContacts(): void {
    if (!this.poseRig || !this.v05HandContacts) {
      this.reportError(
        "v05 hand contacts unavailable",
        new Error("Manifest handContacts are required for runtime IK"),
      );
      return;
    }

    const apply = (
      arm: ArmRig | null,
      contact: V05HandContactManifest,
      statusKey: "rightHandContactLocalMeters" | "leftHandContactLocalMeters",
    ): boolean => {
      if (!arm) return false;
      arm.handContactLocal.copyFrom(Vector3.FromArray(contact.localPosition));
      arm.handRotationOffset.copyFrom(
        new Quaternion(...contact.rotationOffset).normalize(),
      );
      this.status.motion[statusKey] = arm.handContactLocal.length();
      return this.vectorFinite(arm.handContactLocal) &&
        contact.rotationOffset.every((component) => Number.isFinite(component));
    };

    const rightApplied = apply(
      this.poseRig.rightArm,
      this.v05HandContacts.right,
      "rightHandContactLocalMeters",
    );
    const leftApplied = apply(
      this.poseRig.leftArm,
      this.v05HandContacts.left,
      "leftHandContactLocalMeters",
    );
    this.status.motion.ikFinite = rightApplied && leftApplied;
  }

  /** Runs after Babylon evaluates imported animation groups. */
  private applyPresentationPose(): void {
    if (!this.poseRig || !this.weaponRoot || !this.weaponAttachment) {
      this.applyRemotePresentationPose();
      return;
    }
    const target = this.weaponTarget.snapshot();
    const targetPosition = Vector3.FromArray(target.worldPosition);
    const targetGameplayRotation = new Quaternion(
      target.worldRotation[0],
      target.worldRotation[1],
      target.worldRotation[2],
      target.worldRotation[3],
    ).normalize();
    const targetVisibleRotation = targetGameplayRotation
      .clone()
      .multiply(this.assetWeaponCorrection)
      .normalize();

    if (!this.presentationInitialized) {
      this.presentationRotation.copyFrom(targetVisibleRotation);
      this.presentationInitialized = true;
    } else if (this.motionSmoothingEnabled) {
      Quaternion.SlerpToRef(
        this.presentationRotation,
        targetVisibleRotation,
        MOTION_SMOOTHING_ALPHA,
        this.weaponSmoothingRotation,
      );
      this.presentationRotation.copyFrom(this.weaponSmoothingRotation);
    } else {
      this.presentationRotation.copyFrom(targetVisibleRotation);
    }

    const visiblePoints = deriveWeaponPosePoints(
      targetPosition,
      this.presentationRotation,
      this.weaponAttachment.geometry,
    );
    // WeaponRoot stays in its exported BAIZHONG_ROOT hierarchy. Moving this
    // root keeps Shinai and every marker in one authored subtree.
    this.setWeaponRootPose(targetPosition, this.presentationRotation);
    // Importer-linked animation nodes are copied into bones by Skeleton.prepare
    // during the render path. Prepare the animation pose first, then apply a
    // baseline-relative torso delta and finally solve the detached arm chain.
    this.poseRig.skeleton.prepare(true);
    this.poseRig.skeleton.computeAbsoluteMatrices(true);
    const torsoBaseline = this.captureTorsoFollowBaseline();
    this.applyTorsoFollow(targetGameplayRotation, torsoBaseline);
    this.poseRig.skeleton.computeAbsoluteMatrices(true);
    this.applyArmIk(this.poseRig.rightArm, visiblePoints.primaryHandTarget, this.presentationRotation);
    this.poseRig.skeleton.computeAbsoluteMatrices(true);
    this.applyArmIk(this.poseRig.leftArm, visiblePoints.secondaryHandTarget, this.presentationRotation);
    this.poseRig.skeleton.computeAbsoluteMatrices(true);
    this.applyRemotePresentationPose();
    const resolvedTarget = this.weaponTarget.snapshot();

    this.status.motion.gameplayWeaponQuaternion = quaternionToTuple(targetGameplayRotation);
    this.status.motion.weaponQuaternion = quaternionToTuple(this.presentationRotation);
    const gameplayForward = this.gameplayBladeForwardAxis()
      .rotateByQuaternionToRef(targetGameplayRotation, new Vector3())
      .normalize();
    const gameplayUp = (this.gameplayGeometry?.bladeUp ?? Vector3.Up())
      .rotateByQuaternionToRef(targetGameplayRotation, new Vector3())
      .normalize();
    const visibleShinaiForward = this.getVisibleShinaiForward();
    this.status.motion.gameplaySwordForward = vectorTuple(gameplayForward);
    this.status.motion.gameplaySwordUp = vectorTuple(gameplayUp);
    this.status.motion.visibleShinaiForward = visibleShinaiForward
      ? vectorTuple(visibleShinaiForward)
      : null;
    this.status.motion.gameplayVisibleForwardDot = visibleShinaiForward
      ? Math.max(-1, Math.min(1, Vector3.Dot(gameplayForward, visibleShinaiForward)))
      : null;
    // Kept as a compatibility alias for existing callers; the explicit
    // diagnostics above distinguish gameplay from the real visible subtree.
    this.status.motion.swordForward = vectorTuple(gameplayForward);
    this.status.motion.primaryHandTarget = [
      visiblePoints.primaryHandTarget.x,
      visiblePoints.primaryHandTarget.y,
      visiblePoints.primaryHandTarget.z,
    ];
    this.status.motion.secondaryHandTarget = [
      visiblePoints.secondaryHandTarget.x,
      visiblePoints.secondaryHandTarget.y,
      visiblePoints.secondaryHandTarget.z,
    ];
    this.updateDebugGeometry(resolvedTarget, visiblePoints);
  }

  private applyRemotePresentationPose(): void {
    if (
      !this.remoteActive ||
      !this.remotePoseRig ||
      !this.remoteWeaponAttachment ||
      !this.remoteWeaponRoot
    ) {
      return;
    }
    const target = this.remoteWeaponTarget.snapshot();
    const targetPosition = Vector3.FromArray(target.worldPosition);
    const targetGameplayRotation = new Quaternion(
      target.worldRotation[0],
      target.worldRotation[1],
      target.worldRotation[2],
      target.worldRotation[3],
    ).normalize();
    const targetVisibleRotation = targetGameplayRotation
      .clone()
      .multiply(this.assetWeaponCorrection)
      .normalize();
    if (!this.remotePresentationInitialized) {
      this.remotePresentationRotation.copyFrom(targetVisibleRotation);
      this.remotePresentationInitialized = true;
    } else {
      this.remotePresentationRotation.copyFrom(targetVisibleRotation);
    }
    this.setWeaponRootPoseOn(
      this.remoteWeaponAttachment,
      this.remoteWeaponRoot,
      targetPosition,
      this.remotePresentationRotation,
    );
    const rig = this.remotePoseRig;
    rig.skeleton.computeAbsoluteMatrices(true);
    this.applyRemoteArmIk(
      rig,
      this.remoteWeaponAttachment,
      rig.rightArm,
      this.remotePresentationRotation,
    );
    rig.skeleton.computeAbsoluteMatrices(true);
    this.applyRemoteArmIk(
      rig,
      this.remoteWeaponAttachment,
      rig.leftArm,
      this.remotePresentationRotation,
    );
    rig.skeleton.computeAbsoluteMatrices(true);
  }

  /** Solves the opponent arms from received GripPrimary data. */
  private applyRemoteArmIk(
    rig: PoseRig,
    attachment: WeaponAttachment,
    arm: ArmRig | null,
    swordRotation: Quaternion,
  ): void {
    if (!arm) return;
    this.syncAnimatedArmChain(arm);
    rig.skeleton.computeAbsoluteMatrices(true);
    const origin = arm.upperArm.getAbsolutePosition(rig.mesh);
    const markerGrip = this.markerWorldPosition(
      arm.side === "right" ? attachment.primaryGrip : attachment.secondaryGrip,
    );
    const desiredHandRotation = this.desiredHandRotation(arm, swordRotation);
    const desiredWrist = deriveWristTargetFromGrip(
      markerGrip,
      desiredHandRotation,
      arm.handContactLocal,
    );
    const clamped = clampTwoBoneTarget(
      origin,
      desiredWrist,
      arm.firstLength,
      arm.secondLength,
      0.04,
      0.001,
    );
    const forward = this.fighterForward(rig.root);
    const lateral = rig.root.getDirection(Vector3.Right()).normalize();
    const side = arm.side === "right" ? 1 : -1;
    const pole = origin
      .add(lateral.scale(side * POLE_LATERAL_OFFSET))
      .add(forward.scale(POLE_FORWARD_OFFSET))
      .add(Vector3.Up().scale(POLE_UP_OFFSET));
    arm.targetNode.position.copyFrom(clamped.target);
    arm.poleNode.position.copyFrom(pole);
    arm.controller.update();
    rig.skeleton.computeAbsoluteMatrices(true);
    arm.hand.setRotationQuaternion(desiredHandRotation, Space.WORLD, rig.mesh);
  }

  private getVisibleShinaiForward(): Vector3 | null {
    const attachment = this.weaponAttachment;
    if (!attachment) return null;
    attachment.bladeBase.computeWorldMatrix(true);
    attachment.bladeTip.computeWorldMatrix(true);
    const base = Vector3.TransformCoordinates(Vector3.Zero(), attachment.bladeBase.getWorldMatrix());
    const tip = Vector3.TransformCoordinates(Vector3.Zero(), attachment.bladeTip.getWorldMatrix());
    const forward = tip.subtract(base);
    return this.vectorFinite(forward) && forward.length() > 1e-6
      ? forward.normalize()
      : null;
  }

  private captureTorsoFollowBaseline(): TorsoFollowBaseline {
    if (!this.poseRig) {
      return { spine: null, chest: null, rightShoulder: null, leftShoulder: null };
    }
    return {
      spine: this.captureBoneLocalRotation(this.poseRig.spine),
      chest: this.captureBoneLocalRotation(this.poseRig.chest),
      rightShoulder: this.captureBoneLocalRotation(this.poseRig.rightArm?.shoulder ?? null),
      leftShoulder: this.captureBoneLocalRotation(this.poseRig.leftArm?.shoulder ?? null),
    };
  }

  private captureBoneLocalRotation(bone: Bone | null): Quaternion | null {
    if (!bone) return null;
    return bone.rotationQuaternion.clone().normalize();
  }

  private applyTorsoFollow(
    targetRotation: Quaternion,
    baseline: TorsoFollowBaseline,
  ): void {
    if (!this.poseRig) return;
    const root = this.poseRig.root;
    const forward = this.fighterForward(root);
    const lateral = Vector3.Cross(Vector3.Up(), forward).normalize();
    const localPitchAxis = this.rootLocalDirectionFromWorld(root, lateral);
    const targetForward = this.gameplayBladeForwardAxis()
      .rotateByQuaternionToRef(targetRotation, new Vector3())
      .normalize();
    const horizontal = Math.max(
      Math.hypot(Vector3.Dot(targetForward, forward), Vector3.Dot(targetForward, lateral)),
      1e-5,
    );
    const yaw = Math.atan2(
      Vector3.Dot(targetForward, lateral),
      Vector3.Dot(targetForward, forward),
    );
    const pitch = Math.atan2(Vector3.Dot(targetForward, Vector3.Up()), horizontal);
    const safeYaw = Math.max(-TORSO_MAX_YAW, Math.min(TORSO_MAX_YAW, yaw));
    const safePitch = Math.max(-TORSO_MAX_PITCH, Math.min(TORSO_MAX_PITCH, pitch));
    this.status.motion.torsoFollowYawRadians = safeYaw;
    this.status.motion.torsoFollowPitchRadians = safePitch;

    if (!this.torsoFollowEnabled) {
      // Skeleton.prepare already restored the animation-only pose. Leaving
      // those local rotations untouched makes the OFF toggle exact and avoids
      // any presentation work that could accumulate across frames.
      this.status.motion.torsoFollowDeltaRadians = 0;
      this.status.motion.torsoFollowDriftRadians = 0;
      return;
    }

    const entries: Array<{
      bone: Bone | null;
      base: Quaternion | null;
      yawWeight: number;
      pitchWeight: number;
    }> = [
      { bone: this.poseRig.spine, base: baseline.spine, yawWeight: 0.12, pitchWeight: 0.08 },
      { bone: this.poseRig.chest, base: baseline.chest, yawWeight: 0.20, pitchWeight: 0.14 },
      {
        bone: this.poseRig.rightArm?.shoulder ?? null,
        base: baseline.rightShoulder,
        yawWeight: 0.25,
        pitchWeight: 0.18,
      },
      {
        bone: this.poseRig.leftArm?.shoulder ?? null,
        base: baseline.leftShoulder,
        yawWeight: 0.25,
        pitchWeight: 0.18,
      },
    ];
    let maximumDelta = 0;
    let maximumDrift = 0;
    for (const entry of entries) {
      const expected = this.applyBoneFollow(
        entry.bone,
        entry.base,
        safeYaw,
        safePitch,
        entry.yawWeight,
        entry.pitchWeight,
        localPitchAxis,
      );
      if (!expected || !entry.bone) continue;
      const actual = this.captureBoneLocalRotation(entry.bone);
      if (!actual || !entry.base) continue;
      maximumDelta = Math.max(
        maximumDelta,
        quaternionAngularDistance(entry.base, actual),
      );
      maximumDrift = Math.max(
        maximumDrift,
        quaternionAngularDistance(expected, actual),
      );
    }
    this.status.motion.torsoFollowDeltaRadians = maximumDelta;
    this.status.motion.torsoFollowDriftRadians = maximumDrift;
  }

  private applyBoneFollow(
    bone: Bone | null,
    baseRotation: Quaternion | null,
    yaw: number,
    pitch: number,
    yawWeight: number,
    pitchWeight: number,
    pitchAxis: Vector3,
  ): Quaternion | null {
    if (!bone || !this.poseRig || !baseRotation) return null;
    const result = composeTorsoFollowRotation(
      baseRotation,
      yaw,
      pitch,
      yawWeight,
      pitchWeight,
      pitchAxis,
      this.torsoFollowEnabled,
    );
    // Apply the delta in the bone's local frame. A world-space setter on a
    // parent torso bone changes descendant joint positions under Babylon's
    // skeleton matrix convention, which in turn invalidates the IK origin.
    bone.setRotationQuaternion(result, Space.LOCAL);
    return result;
  }

  private applyArmIk(
    arm: ArmRig | null,
    desiredGrip: Vector3,
    swordRotation: Quaternion,
  ): void {
    if (!arm || !this.poseRig) return;
    this.syncAnimatedArmChain(arm);
    this.poseRig.skeleton.computeAbsoluteMatrices(true);
    const origin = arm.upperArm.getAbsolutePosition(this.poseRig.mesh);
    // Read the authored marker after WeaponRoot has been posed. This keeps
    // the contact diagnostic tied to the real GripPrimary/GripSecondary node
    // rather than reusing the target math that produced the desired point.
    const markerGrip = this.weaponAttachment
      ? this.markerWorldPosition(
        arm.side === "right"
          ? this.weaponAttachment.primaryGrip
          : this.weaponAttachment.secondaryGrip,
      )
      : desiredGrip;
    const desiredHandRotation = this.desiredHandRotation(arm, swordRotation);
    const desiredWrist = deriveWristTargetFromGrip(
      markerGrip,
      desiredHandRotation,
      arm.handContactLocal,
    );
    const clamped = clampTwoBoneTarget(
      origin,
      desiredWrist,
      arm.firstLength,
      arm.secondLength,
      0.04,
      0.001,
    );
    const pole = this.computeElbowPole(arm, origin);
    arm.origin.copyFrom(origin);
    arm.target.copyFrom(clamped.target);
    arm.pole.copyFrom(pole);
    arm.clamped = clamped.clamped;
    arm.finite = clamped.finite && this.vectorFinite(pole);
    arm.targetNode.position.copyFrom(clamped.target);
    arm.poleNode.position.copyFrom(pole);
    arm.controller.update();
    this.poseRig.skeleton.computeAbsoluteMatrices(true);

    arm.hand.setRotationQuaternion(desiredHandRotation, Space.WORLD, this.poseRig.mesh);

    const handPosition = arm.hand.getAbsolutePosition(this.poseRig.mesh);
    const handRotation = arm.hand
      .getRotationQuaternion(Space.WORLD, this.poseRig.mesh)
      .clone()
      .normalize();
    arm.contact.copyFrom(
      deriveActualHandContact(handPosition, handRotation, arm.handContactLocal),
    );
    arm.gripErrorMeters = arm.contact.subtract(markerGrip).length();
    arm.finite = arm.finite &&
      this.vectorFinite(desiredWrist) &&
      this.vectorFinite(arm.contact) &&
      Number.isFinite(arm.gripErrorMeters);

    this.status.motion.ikClamped = Boolean(
      this.poseRig.rightArm?.clamped || this.poseRig.leftArm?.clamped,
    );
    this.status.motion.rightIkClamped = Boolean(this.poseRig.rightArm?.clamped);
    this.status.motion.leftIkClamped = Boolean(this.poseRig.leftArm?.clamped);
    this.status.motion.ikFinite = Boolean(
      this.poseRig.rightArm?.finite &&
      this.poseRig.leftArm?.finite &&
      Number.isFinite(this.poseRig.rightArm.gripErrorMeters) &&
      Number.isFinite(this.poseRig.leftArm.gripErrorMeters),
    );
    if (arm.side === "right") {
      this.status.motion.rightElbowPole = [pole.x, pole.y, pole.z];
      this.status.motion.rightHandContact = [arm.contact.x, arm.contact.y, arm.contact.z];
      this.status.motion.rightGripErrorMeters = arm.gripErrorMeters;
    } else {
      this.status.motion.leftElbowPole = [pole.x, pole.y, pole.z];
      this.status.motion.leftHandContact = [arm.contact.x, arm.contact.y, arm.contact.z];
      this.status.motion.leftGripErrorMeters = arm.gripErrorMeters;
    }
  }

  private markerWorldPosition(marker: TransformNode): Vector3 {
    marker.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(Vector3.Zero(), marker.getWorldMatrix());
  }

  /**
   * Replays the current animation values for the detached IK chain. The
   * transform nodes remain the animation authority; the bones are detached
   * only so a later Skeleton.prepare call cannot overwrite procedural IK.
   */
  private syncAnimatedArmChain(arm: ArmRig): void {
    const sync = (bone: Bone, node: TransformNode | null): void => {
      if (!node) return;
      bone.position.copyFrom(node.position);
      if (node.rotationQuaternion) {
        bone.rotationQuaternion = node.rotationQuaternion;
      } else {
        bone.rotation = node.rotation;
      }
      bone.scaling.copyFrom(node.scaling);
    };
    sync(arm.upperArm, arm.animatedUpperArmNode);
    sync(arm.forearm, arm.animatedForearmNode);
    sync(arm.hand, arm.animatedHandNode);
  }

  private computeElbowPole(arm: ArmRig, origin: Vector3): Vector3 {
    if (!this.poseRig) return origin.clone();
    const root = this.poseRig.root;
    const forward = this.fighterForward(root);
    const lateral = root.getDirection(Vector3.Right()).normalize();
    const side = arm.side === "right" ? 1 : -1;
    return origin
      .add(lateral.scale(side * POLE_LATERAL_OFFSET))
      .add(forward.scale(POLE_FORWARD_OFFSET))
      .add(Vector3.Up().scale(POLE_UP_OFFSET));
  }

  private createDebugGeometry(): void {
    this.weaponDebugLine = MeshBuilder.CreateLines(
      "weapon-target-debug",
      { points: [Vector3.Zero(), Vector3.Up()], updatable: true },
      this.scene,
    );
    this.weaponDebugLine.color = new Color3(0.95, 0.45, 0.18);
    this.gripDebugLine = MeshBuilder.CreateLines(
      "weapon-grip-debug",
      { points: [Vector3.Zero(), Vector3.Up()], updatable: true },
      this.scene,
    );
    this.gripDebugLine.color = new Color3(0.95, 0.78, 0.24);
    this.shellDebugLine = MeshBuilder.CreateLines(
      "weapon-reach-shell-debug",
      { points: this.makeShellDebugPoints(Vector3.Zero(), 0.4), updatable: true },
      this.scene,
    );
    this.shellDebugLine.color = new Color3(0.85, 0.35, 0.8);
    this.targetDebugLine = MeshBuilder.CreateLines(
      "weapon-target-points-debug",
      { points: [Vector3.Zero(), Vector3.Up(), Vector3.Right()], updatable: true },
      this.scene,
    );
    this.targetDebugLine.color = new Color3(1, 0.92, 0.35);
    this.shoulderDebugLine = MeshBuilder.CreateLines(
      "weapon-shoulder-target-debug",
      { points: [Vector3.Zero(), Vector3.Up(), Vector3.Right()], updatable: true },
      this.scene,
    );
    this.shoulderDebugLine.color = new Color3(0.95, 0.55, 0.25);
    this.rightIkDebugLine = MeshBuilder.CreateLines(
      "weapon-right-ik-debug",
      { points: [Vector3.Zero(), Vector3.Up(), Vector3.Right()], updatable: true },
      this.scene,
    );
    this.rightIkDebugLine.color = new Color3(0.25, 0.85, 0.95);
    this.leftIkDebugLine = MeshBuilder.CreateLines(
      "weapon-left-ik-debug",
      { points: [Vector3.Zero(), Vector3.Up(), Vector3.Right()], updatable: true },
      this.scene,
    );
    this.leftIkDebugLine.color = new Color3(0.60, 0.95, 0.55);
    this.setWeaponDebugVisibility(this.status.motion.showWeaponDebug);
    this.setIkDebugVisibility(this.status.motion.showIkDebug);
  }

  private makeShellDebugPoints(center: Vector3, radius: number): Vector3[] {
    const points: Vector3[] = [];
    const segments = 32;
    const safeRadius = Math.max(radius, 0.01);
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      points.push(center.add(new Vector3(Math.cos(angle) * safeRadius, Math.sin(angle) * safeRadius, 0)));
    }
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      points.push(center.add(new Vector3(Math.cos(angle) * safeRadius, 0, Math.sin(angle) * safeRadius)));
    }
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      points.push(center.add(new Vector3(0, Math.cos(angle) * safeRadius, Math.sin(angle) * safeRadius)));
    }
    return points;
  }

  private updateDebugGeometry(
    target: WeaponTargetSnapshot,
    visiblePoints: ReturnType<typeof deriveWeaponPosePoints>,
  ): void {
    if (this.weaponDebugLine) {
      this.weaponDebugLine = MeshBuilder.CreateLines(
        "weapon-target-debug",
        {
          points: [Vector3.FromArray(target.swordBase), Vector3.FromArray(target.swordTip)],
          instance: this.weaponDebugLine,
        },
        this.scene,
      );
    }
    if (this.gripDebugLine) {
      this.gripDebugLine = MeshBuilder.CreateLines(
        "weapon-grip-debug",
        { points: [visiblePoints.primaryHandTarget, visiblePoints.secondaryHandTarget], instance: this.gripDebugLine },
        this.scene,
      );
    }
    if (this.shellDebugLine) {
      const center = this.status.motion.reachCenterWorld
        ? Vector3.FromArray(this.status.motion.reachCenterWorld)
        : Vector3.Zero();
      this.shellDebugLine = MeshBuilder.CreateLines(
        "weapon-reach-shell-debug",
        {
          points: this.makeShellDebugPoints(
            center,
            this.status.motion.reachShellRadiusMeters ?? 0.4,
          ),
          instance: this.shellDebugLine,
        },
        this.scene,
      );
    }
    if (this.targetDebugLine) {
      const primary = Vector3.FromArray(target.worldPosition);
      const secondary = Vector3.FromArray(target.secondaryHandTarget);
      const base = Vector3.FromArray(target.swordBase);
      const tip = Vector3.FromArray(target.swordTip);
      this.targetDebugLine = MeshBuilder.CreateLines(
        "weapon-target-points-debug",
        { points: [primary, secondary, base, tip], instance: this.targetDebugLine },
        this.scene,
      );
    }
    if (this.shoulderDebugLine && this.poseRig) {
      const right = this.poseRig.rightArm?.shoulder.getAbsolutePosition(this.poseRig.mesh) ?? Vector3.Zero();
      const left = this.poseRig.leftArm?.shoulder.getAbsolutePosition(this.poseRig.mesh) ?? Vector3.Zero();
      this.shoulderDebugLine = MeshBuilder.CreateLines(
        "weapon-shoulder-target-debug",
        { points: [right, Vector3.FromArray(target.worldPosition), left, Vector3.FromArray(target.secondaryHandTarget)], instance: this.shoulderDebugLine },
        this.scene,
      );
    }
    if (this.rightIkDebugLine && this.poseRig?.rightArm) {
      const arm = this.poseRig.rightArm;
      this.rightIkDebugLine = MeshBuilder.CreateLines(
        "weapon-right-ik-debug",
        { points: [arm.origin, arm.target, arm.pole], instance: this.rightIkDebugLine },
        this.scene,
      );
    }
    if (this.leftIkDebugLine && this.poseRig?.leftArm) {
      const arm = this.poseRig.leftArm;
      this.leftIkDebugLine = MeshBuilder.CreateLines(
        "weapon-left-ik-debug",
        { points: [arm.origin, arm.target, arm.pole], instance: this.leftIkDebugLine },
        this.scene,
      );
    }
  }

  private vectorFinite(value: Vector3): boolean {
    return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
  }

  private render(): void {
    if (this.disposed) return;

    const frameDelta = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
    this.accumulator = Math.min(this.accumulator + frameDelta, SIM_DT * 8);
    while (this.accumulator >= SIM_DT) {
      this.simulationStep(SIM_DT);
      this.accumulator -= SIM_DT;
    }

    this.updateFollowCamera(frameDelta);
    this.scene.render();

    const now = performance.now();
    if (now - this.lastStatusTime >= 250) {
      this.lastStatusTime = now;
      this.status.fps = Math.round(this.engine.getFps());
      this.status.simulationTicks = this.simulationTicks;
      this.emitStatus(false);
    }
  }

  private reportError(prefix: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `${prefix}: ${detail}`;
    console.error(`[Chambara] ${message}`, error);
    if (!this.status.errors.includes(message)) {
      this.status.errors = [...this.status.errors, message];
    }
  }

  private emitStatus(force: boolean): void {
    if (!force && this.disposed) return;
    const motion = this.status.motion;
    this.statusListener({
      ...this.status,
      weaponNodes: { ...this.status.weaponNodes },
      discoveredAnimations: [...this.status.discoveredAnimations],
      missingAnimations: [...this.status.missingAnimations],
      errors: [...this.status.errors],
      motion: {
        ...motion,
        quaternion: motion.quaternion ? ([...motion.quaternion] as QuaternionTuple) : null,
        rawDeviceQuaternion: motion.rawDeviceQuaternion
          ? ([...motion.rawDeviceQuaternion] as QuaternionTuple)
          : null,
        calibrationReferenceQuaternion: motion.calibrationReferenceQuaternion
          ? ([...motion.calibrationReferenceQuaternion] as QuaternionTuple)
          : null,
        relativeQuaternion: motion.relativeQuaternion
          ? ([...motion.relativeQuaternion] as QuaternionTuple)
          : null,
        mappedGameQuaternion: motion.mappedGameQuaternion
          ? ([...motion.mappedGameQuaternion] as QuaternionTuple)
          : null,
        phoneToGameplayBasisQuaternion: motion.phoneToGameplayBasisQuaternion
          ? ([...motion.phoneToGameplayBasisQuaternion] as QuaternionTuple)
          : null,
        neutralWeaponQuaternion: motion.neutralWeaponQuaternion
          ? ([...motion.neutralWeaponQuaternion] as QuaternionTuple)
          : null,
        visibleNeutralWeaponQuaternion: motion.visibleNeutralWeaponQuaternion
          ? ([...motion.visibleNeutralWeaponQuaternion] as QuaternionTuple)
          : null,
        gameplayWeaponQuaternion: motion.gameplayWeaponQuaternion
          ? ([...motion.gameplayWeaponQuaternion] as QuaternionTuple)
          : null,
        weaponQuaternion: motion.weaponQuaternion
          ? ([...motion.weaponQuaternion] as QuaternionTuple)
          : null,
        weaponTargetRootAnchor: motion.weaponTargetRootAnchor
          ? ([...motion.weaponTargetRootAnchor] as [number, number, number])
          : null,
        weaponTargetPosition: motion.weaponTargetPosition
          ? ([...motion.weaponTargetPosition] as [number, number, number])
          : null,
        weaponTargetQuaternion: motion.weaponTargetQuaternion
          ? ([...motion.weaponTargetQuaternion] as QuaternionTuple)
          : null,
        weaponTargetBase: motion.weaponTargetBase
          ? ([...motion.weaponTargetBase] as [number, number, number])
          : null,
        weaponTargetTip: motion.weaponTargetTip
          ? ([...motion.weaponTargetTip] as [number, number, number])
          : null,
        primaryHandTarget: motion.primaryHandTarget
          ? ([...motion.primaryHandTarget] as [number, number, number])
          : null,
        secondaryHandTarget: motion.secondaryHandTarget
          ? ([...motion.secondaryHandTarget] as [number, number, number])
          : null,
        rightElbowPole: motion.rightElbowPole
          ? ([...motion.rightElbowPole] as [number, number, number])
          : null,
        leftElbowPole: motion.leftElbowPole
          ? ([...motion.leftElbowPole] as [number, number, number])
          : null,
        gameplaySwordForward: motion.gameplaySwordForward
          ? ([...motion.gameplaySwordForward] as [number, number, number])
          : null,
        gameplaySwordUp: motion.gameplaySwordUp
          ? ([...motion.gameplaySwordUp] as [number, number, number])
          : null,
        visibleShinaiForward: motion.visibleShinaiForward
          ? ([...motion.visibleShinaiForward] as [number, number, number])
          : null,
        bladeForwardInPrimaryFrame: motion.bladeForwardInPrimaryFrame
          ? ([...motion.bladeForwardInPrimaryFrame] as [number, number, number])
          : null,
        bladeUpInPrimaryFrame: motion.bladeUpInPrimaryFrame
          ? ([...motion.bladeUpInPrimaryFrame] as [number, number, number])
          : null,
        bladeRightInPrimaryFrame: motion.bladeRightInPrimaryFrame
          ? ([...motion.bladeRightInPrimaryFrame] as [number, number, number])
          : null,
        assetFrameCorrectionQuaternion: motion.assetFrameCorrectionQuaternion
          ? ([...motion.assetFrameCorrectionQuaternion] as QuaternionTuple)
          : null,
        swordForward: motion.swordForward
          ? ([...motion.swordForward] as [number, number, number])
          : null,
        rightHandContact: motion.rightHandContact
          ? ([...motion.rightHandContact] as [number, number, number])
          : null,
        leftHandContact: motion.leftHandContact
          ? ([...motion.leftHandContact] as [number, number, number])
          : null,
      },
    });
  }
}
