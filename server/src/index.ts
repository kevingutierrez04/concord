import { WebSocketServer, type WebSocket } from "ws";
import { RGA } from "../../crdt/src/rga.js";
import { SqliteOpLog, type OpLog } from "./persistence.js";
import { PresenceColors, PresenceNames, sanitizeName } from "./presence.js";
import type { ClientMessage, PresenceEntry, ServerMessage } from "./protocol.js";

export interface ServerOptions {
  store?: OpLog;
  heartbeatMs?: number;
}

export function createServer(port: number, options: ServerOptions = {}) {
  const { store, heartbeatMs = 30_000 } = options;

  const doc = new RGA("server");
  if (store) {
    for (const op of store.load()) doc.applyOp(op);
  }

  const wss = new WebSocketServer({ port });
  const clients = new Set<WebSocket>();
  const presence = new Map<WebSocket, PresenceEntry>();
  const colors = new PresenceColors();
  const names = new PresenceNames();
  const alive = new WeakMap<WebSocket, boolean>();

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
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));

    send(ws, { type: "snapshot", ops: doc.exportOps() });
    send(ws, { type: "presences", users: [...presence.values()] });

    ws.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (message.type === "ops" && Array.isArray(message.ops)) {
        // Apply, persist, then broadcast -- all synchronous, so no other
        // client's batch can interleave between these steps.
        for (const op of message.ops) doc.applyOp(op);
        store?.append(message.ops);
        broadcast({ type: "ops", ops: message.ops }, ws);
      } else if (message.type === "presence" && message.state) {
        // Must be read before presence.set() below, and before either
        // pool is touched -- it's the signal for "this connection hasn't
        // been assigned anything yet."
        const isFirstContact = !presence.has(ws);

        const { color } = colors.ensure(ws);
        const name = names.resolve(ws, sanitizeName(message.state.name));
        if (isFirstContact) send(ws, { type: "identity", name, color });

        const state = { name, color, anchor: message.state.anchor ?? null };
        presence.set(ws, { clientId: String(message.clientId), state });
        broadcast({ type: "presence", clientId: String(message.clientId), state }, ws);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      colors.release(ws);
      names.release(ws);
      const entry = presence.get(ws);
      if (entry) {
        presence.delete(ws);
        broadcast({ type: "presence-leave", clientId: entry.clientId });
      }
    });
  });

  // A peer that vanishes without closing (laptop lid, dropped wifi) never
  // fires "close" until TCP times out, which can take minutes. Ping every
  // interval; a peer that hasn't answered the previous ping is dead.
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, heartbeatMs);
  wss.on("close", () => clearInterval(heartbeat));

  function close() {
    for (const ws of clients) ws.terminate();
    wss.close();
    store?.close();
  }

  return { wss, doc, close };
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const PORT = Number(process.env.PORT ?? 4001);
  const DB_PATH = process.env.DB_PATH ?? "concord.db";
  createServer(PORT, { store: new SqliteOpLog(DB_PATH) });
  console.log(`concord ws server listening on ws://localhost:${PORT} (db: ${DB_PATH})`);
}
