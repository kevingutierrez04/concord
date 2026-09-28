import type { NodeId, Op } from "../../crdt/src/rga";

export interface PresenceState {
  name: string;
  color: string;
  anchor: NodeId | null;
}

export interface PresenceEntry {
  clientId: string;
  state: PresenceState;
}

export type ClientMessage =
  | { type: "ops"; ops: Op[] }
  | { type: "presence"; clientId: string; state: PresenceState };

export type ServerMessage =
  | { type: "snapshot"; ops: Op[] }
  | { type: "ops"; ops: Op[] }
  | { type: "presences"; users: PresenceEntry[] }
  | { type: "presence"; clientId: string; state: PresenceState }
  | { type: "presence-leave"; clientId: string };
