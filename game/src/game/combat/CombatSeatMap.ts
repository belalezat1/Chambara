/**
 * Host-centric combat seats → each client's local view.
 *
 * Authority (host / CombatResolver): playerRootX = P1 (host) left seat,
 * dummyRootX = P2 (guest) right seat.
 *
 * Presentation: every client draws LOCAL on the left (−X) and REMOTE on the
 * right (+X). Host is identity. Guest mirrors so their body (host dummy)
 * lands on local left and the host lands on remote right.
 */

export type SeatPair = {
  playerX: number;
  dummyX: number;
};

export type SoftEdgePair = {
  playerOnSoftEdge: boolean;
  dummyOnSoftEdge: boolean;
};

/**
 * Map host-frame seat X into this client's local/remote seats.
 * Host: identity. Guest: localX = −hostDummyRootX, remoteX = −hostPlayerRootX.
 */
export function mapHostSeatsToLocalView(
  isHost: boolean,
  hostSeats: SeatPair,
): SeatPair {
  if (isHost) {
    return { playerX: hostSeats.playerX, dummyX: hostSeats.dummyX };
  }
  return {
    playerX: -hostSeats.dummyX,
    dummyX: -hostSeats.playerX,
  };
}

/**
 * Soft-edge flags travel with the fighter identity, then mirror with seats.
 * Host player flag → guest remote; host dummy flag → guest local.
 */
export function mapHostSoftEdgeToLocalView(
  isHost: boolean,
  host: SoftEdgePair,
): SoftEdgePair {
  if (isHost) {
    return {
      playerOnSoftEdge: host.playerOnSoftEdge,
      dummyOnSoftEdge: host.dummyOnSoftEdge,
    };
  }
  return {
    playerOnSoftEdge: host.dummyOnSoftEdge,
    dummyOnSoftEdge: host.playerOnSoftEdge,
  };
}

/**
 * Publisher authors GripPrimary under their local-left root. On the receiver,
 * that fighter sits on the remote (dummy) seat, so the publisher's authored
 * root X in their view is −dummyCombatX (identity when seats are ±symmetric).
 */
export function publisherAuthoredRootX(localViewDummyX: number): number {
  return -localViewDummyX;
}
