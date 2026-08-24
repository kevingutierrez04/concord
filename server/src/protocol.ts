export interface DocState {
  content: string;
  updatedAt: number;
  updatedBy: string;
}

export type ClientMessage = {
  type: "update";
  content: string;
  clientId: string;
  timestamp: number;
};

export type ServerMessage =
  | { type: "init"; doc: DocState }
  | { type: "update"; doc: DocState };
