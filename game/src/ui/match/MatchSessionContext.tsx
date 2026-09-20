import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createInitialMatchStatus,
  SpacetimeMatchClient,
  type CombatIntentPublish,
  type CombatOutcomeEvent,
  type MatchClientStatus,
  type RemoteCombatIntent,
} from "../../game/net/SpacetimeMatchClient";
import type { PrimaryGripNetworkPose } from "../../game/net/PrimaryGripProtocol";
import { MotionRelayClient } from "../../game/input/MotionRelayClient";
import {
  createInitialRelayStatus,
  createRoomCode,
  normalizeRoomCode,
  type ControllerSample,
  type RelayStatus,
} from "../../game/input/MotionTypes";

export type MatchSessionEvent =
  | { type: "remotePose"; pose: PrimaryGripNetworkPose | null }
  | { type: "combatIntent"; intent: RemoteCombatIntent }
  | { type: "combatOutcome"; outcome: CombatOutcomeEvent }
  | { type: "phoneSample"; sample: ControllerSample };

export type MatchSessionListener = (event: MatchSessionEvent) => void;

export interface MatchSessionContextValue {
  status: MatchClientStatus;
  endpoint: { uri: string; database: string };
  phoneRoomCode: string;
  phoneStatus: RelayStatus;
  createMatch: () => Promise<string>;
  joinMatch: (rawCode: string) => Promise<void>;
  leaveMatch: () => void;
  regeneratePhoneRoom: () => void;
  setReady: (ready: boolean) => void;
  getOpponentIdentityHex: () => string | null;
  getIdentityHex: () => string | null;
  publishPose: (pose: PrimaryGripNetworkPose) => void;
  publishCombatIntent: (intent: CombatIntentPublish) => void;
  publishCombatOutcome: (outcome: Omit<CombatOutcomeEvent, "roomCode"> & { roomCode?: string }) => void;
  subscribe: (listener: MatchSessionListener) => () => void;
}

const MatchSessionContext = createContext<MatchSessionContextValue | null>(null);

export function MatchSessionProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<SpacetimeMatchClient | null>(null);
  const phoneRelayRef = useRef<MotionRelayClient | null>(null);
  const phoneReadyRef = useRef(false);
  const listenersRef = useRef(new Set<MatchSessionListener>());
  const [status, setStatus] = useState<MatchClientStatus>(createInitialMatchStatus);
  const [phoneRoomCode, setPhoneRoomCode] = useState(createRoomCode);
  const [phoneStatus, setPhoneStatus] = useState<RelayStatus>(() =>
    createInitialRelayStatus("host", phoneRoomCode),
  );

  const emit = useCallback((event: MatchSessionEvent) => {
    for (const listener of listenersRef.current) listener(event);
  }, []);

  const startPhoneRelay = useCallback((room: string) => {
    phoneRelayRef.current?.stop();

    const relay = new MotionRelayClient(
      "host",
      room,
      (nextStatus) => {
        setPhoneStatus(nextStatus);
        if (phoneReadyRef.current !== nextStatus.peerReady) {
          phoneReadyRef.current = nextStatus.peerReady;
          clientRef.current?.setReady(nextStatus.peerReady);
        }
      },
      (sample) => emit({ type: "phoneSample", sample }),
    );
    phoneRelayRef.current = relay;
    relay.start();
  }, [emit]);

  const resetPhoneRoom = useCallback(() => {
    phoneRelayRef.current?.stop();
    phoneRelayRef.current = null;
    phoneReadyRef.current = false;
    const nextRoom = createRoomCode();
    setPhoneRoomCode(nextRoom);
    setPhoneStatus(createInitialRelayStatus("host", nextRoom));
  }, []);

  useEffect(() => {
    const client = new SpacetimeMatchClient({
      onStatus: setStatus,
      onRemotePose: (pose) => emit({ type: "remotePose", pose }),
      onCombatIntent: (intent) => emit({ type: "combatIntent", intent }),
      onCombatOutcome: (outcome) => emit({ type: "combatOutcome", outcome }),
    });
    clientRef.current = client;

    return () => {
      phoneRelayRef.current?.stop();
      phoneRelayRef.current = null;
      client.disconnect();
      clientRef.current = null;
      listenersRef.current.clear();
    };
  }, [emit]);

  useEffect(() => {
    startPhoneRelay(phoneRoomCode);
    return () => {
      phoneRelayRef.current?.stop();
      phoneRelayRef.current = null;
    };
  }, [phoneRoomCode, startPhoneRelay]);

  const createMatch = useCallback(async () => {
    const code = createRoomCode();
    const client = clientRef.current;
    if (!client) throw new Error("Match session is not ready.");
    await client.join(code, "host");
    return code;
  }, []);

  const joinMatch = useCallback(async (rawCode: string) => {
    const code = normalizeRoomCode(rawCode);
    if (!code) {
      setStatus((current) => ({
        ...current,
        connection: "error",
        error: "Enter a valid 6-character match code.",
      }));
      return;
    }
    const client = clientRef.current;
    if (!client) throw new Error("Match session is not ready.");
    await client.join(code, "guest");
  }, []);

  const leaveMatch = useCallback(() => {
    clientRef.current?.leave();
    resetPhoneRoom();
  }, [resetPhoneRoom]);

  const regeneratePhoneRoom = useCallback(() => {
    resetPhoneRoom();
  }, [resetPhoneRoom]);

  const setReady = useCallback((ready: boolean) => {
    clientRef.current?.setReady(ready);
  }, []);

  const getOpponentIdentityHex = useCallback(
    () => clientRef.current?.getOpponentIdentityHex() ?? null,
    [],
  );
  const getIdentityHex = useCallback(
    () => clientRef.current?.getIdentityHex() ?? null,
    [],
  );
  const publishPose = useCallback((pose: PrimaryGripNetworkPose) => {
    clientRef.current?.publishPose(pose);
  }, []);
  const publishCombatIntent = useCallback((intent: CombatIntentPublish) => {
    clientRef.current?.publishCombatIntent(intent);
  }, []);
  const publishCombatOutcome = useCallback(
    (outcome: Omit<CombatOutcomeEvent, "roomCode"> & { roomCode?: string }) => {
      clientRef.current?.publishCombatOutcome(outcome);
    },
    [],
  );
  const subscribe = useCallback((listener: MatchSessionListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const value = useMemo<MatchSessionContextValue>(() => ({
    status,
    endpoint: {
      uri: clientRef.current?.getUri() ?? "—",
      database: clientRef.current?.getDatabase() ?? "—",
    },
    phoneRoomCode,
    phoneStatus,
    createMatch,
    joinMatch,
    leaveMatch,
    regeneratePhoneRoom,
    setReady,
    getOpponentIdentityHex,
    getIdentityHex,
    publishPose,
    publishCombatIntent,
    publishCombatOutcome,
    subscribe,
  }), [
    createMatch,
    getIdentityHex,
    getOpponentIdentityHex,
    joinMatch,
    leaveMatch,
    phoneRoomCode,
    phoneStatus,
    publishCombatIntent,
    publishCombatOutcome,
    publishPose,
    regeneratePhoneRoom,
    setReady,
    status,
    subscribe,
  ]);

  return (
    <MatchSessionContext.Provider value={value}>
      {children}
    </MatchSessionContext.Provider>
  );
}

export function useMatchSession(): MatchSessionContextValue {
  const session = useContext(MatchSessionContext);
  if (!session) throw new Error("useMatchSession must be used within MatchSessionProvider");
  return session;
}
