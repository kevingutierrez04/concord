import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, DocState, ServerMessage } from "./protocol.js";

const PORT = Number(process.env.PORT ?? 4001);

let doc: DocState = {
  content: "",
  updatedAt: 0,
  updatedBy: "server",
};

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
  send(ws, { type: "init", doc });

  ws.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type !== "update") return;

    // Newer timestamp wins; equal timestamps break the tie on clientId.
    const isNewer =
      message.timestamp > doc.updatedAt ||
      (message.timestamp === doc.updatedAt && message.clientId > doc.updatedBy);

    if (!isNewer) {
      // Sender lost the race — send it back the authoritative doc.
      send(ws, { type: "init", doc });
      return;
    }

    doc = {
      content: message.content,
      updatedAt: message.timestamp,
      updatedBy: message.clientId,
    };
    broadcast({ type: "update", doc }, ws);
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

console.log(`concord ws server listening on ws://localhost:${PORT}`);
