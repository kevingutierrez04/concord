import { WebSocketServer, type WebSocket } from "ws";
import { RGA } from "../../crdt/src/rga.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";

const PORT = Number(process.env.PORT ?? 4001);

const doc = new RGA("server");

const wss = new WebSocketServer({ port: PORT });
const clients = new Set<WebSocket>();

function send(ws: WebSocket, message: ServerMessage) {
  ws.send(JSON.stringify(message));
}

function broadcast(message: ServerMessage, exclude?: WebSocket) {
  for (const client of clients) {
    if (client !== exclude && client.readyState === client.OPEN) {
      send(client, message);
    }
  }
}

wss.on("connection", (ws) => {
  clients.add(ws);
  send(ws, { type: "snapshot", ops: doc.exportOps() });

  ws.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type !== "ops") return;

    for (const op of message.ops) {
      doc.applyOp(op);
    }
    broadcast({ type: "ops", ops: message.ops }, ws);
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

console.log(`concord ws server listening on ws://localhost:${PORT}`);
