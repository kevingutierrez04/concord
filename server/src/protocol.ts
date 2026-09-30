import type { NodeId, Op } from "../../crdt/src/rga.js";

export interface PresenceState {
  name: string;
  color: string;
  anchor: NodeId | null;
}

export interface PresenceEntry {
  clientId: string;
  state: PresenceState;
}

// What a client reports about itself. `name` may be empty, meaning "I
// haven't chosen one" -- the server then generates a unique one (see
// server/src/presence.ts). Color is never client-supplied at all; the
// server always assigns it, so two simultaneous participants can never
// collide on either.
export interface OwnPresenceState {
  name: string;
  anchor: NodeId | null;
}

export type ClientMessage =
  | { type: "ops"; ops: Op[] }
  | { type: "presence"; clientId: string; state: OwnPresenceState };

export type ServerMessage =
  | { type: "snapshot"; ops: Op[] }
  | { type: "ops"; ops: Op[] }
  | { type: "presences"; users: PresenceEntry[] }
  | { type: "presence"; clientId: string; state: PresenceState }
  | { type: "presence-leave"; clientId: string }
  // Sent once, the first time a connection announces presence: what name
  // and color the server assigned (the name may just echo back what the
  // client already chose, if it chose one).
  | { type: "identity"; name: string; color: string };
