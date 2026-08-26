import type { Op } from "../../crdt/src/rga.js";

export type ClientMessage = {
  type: "ops";
  ops: Op[];
};

export type ServerMessage =
  | { type: "snapshot"; ops: Op[] }
  | { type: "ops"; ops: Op[] };
