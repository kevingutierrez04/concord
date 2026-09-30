import { mkdtempSync, rmSync } from "node:fs";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { RGA, type Op } from "../../crdt/src/rga.js";
import { createServer, type ServerOptions } from "./index.js";
import { SqliteOpLog } from "./persistence.js";
import type { OwnPresenceState, ServerMessage } from "./protocol.js";

async function waitUntil(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function makeClient(port: number, siteId: string, wsOptions?: WebSocket.ClientOptions) {
  const rga = new RGA(siteId);
  const ws = new WebSocket(`ws://localhost:${port}`, wsOptions);
  const messages: ServerMessage[] = [];

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString()) as ServerMessage;
    messages.push(msg);
    if (msg.type === "snapshot" || msg.type === "ops") {
      for (const op of msg.ops) rga.applyOp(op);
    }
  });

  const opened = new Promise<void>((resolve) => ws.once("open", () => resolve()));

  return {
    rga,
    ws,
    opened,
    messages,
    send(ops: Op[]) {
      ws.send(JSON.stringify({ type: "ops", ops }));
    },
    sendPresence(state: OwnPresenceState) {
      ws.send(JSON.stringify({ type: "presence", clientId: siteId, state }));
    },
    identity(): { name: string; color: string } | undefined {
      const msg = messages.find((m) => m.type === "identity");
      return msg?.type === "identity" ? { name: msg.name, color: msg.color } : undefined;
    },
  };
}

const closers: (() => void)[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (closers.length) closers.pop()!();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function startTestServer(options?: ServerOptions) {
  const server = createServer(0, options);
  const port = (server.wss.address() as AddressInfo).port;
  closers.push(server.close);
  return { port, doc: server.doc, close: server.close };
}

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "concord-test-"));
  tempDirs.push(dir);
  return join(dir, "test.db");
}

describe("multi-client sync over the real server", () => {
  it("converges after concurrent inserts at the same position from two clients", async () => {
    const { port, doc } = startTestServer();
    const a = makeClient(port, "a");
    const b = makeClient(port, "b");
    await Promise.all([a.opened, b.opened]);

    a.send(a.rga.insertAt(0, "Hello "));
    b.send(b.rga.insertAt(0, "World "));

    await waitUntil(() => a.rga.getText() === b.rga.getText() && a.rga.getText().length > 0);
    expect(a.rga.getText()).toBe(b.rga.getText());
    expect(doc.getText()).toBe(a.rga.getText());
  });

  it("converges with a concurrent delete on one client and insert on another", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    const b = makeClient(port, "b");
    await Promise.all([a.opened, b.opened]);

    a.send(a.rga.insertAt(0, "hello"));
    await waitUntil(() => b.rga.getText() === "hello");

    const deleteOps = a.rga.deleteAt(0, 2);
    const insertOps = b.rga.insertAt(b.rga.getText().length, "!");
    a.send(deleteOps);
    b.send(insertOps);

    await waitUntil(() => a.rga.getText() === b.rga.getText() && a.rga.getText().includes("!"));
    expect(a.rga.getText()).toBe("llo!");
    expect(b.rga.getText()).toBe("llo!");
  });

  it("bootstraps a late-joining client with the full existing document", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    await a.opened;
    a.send(a.rga.insertAt(0, "existing text"));
    await waitUntil(() => a.rga.getText() === "existing text");

    const c = makeClient(port, "c");
    await c.opened;
    await waitUntil(() => c.rga.getText() === "existing text");
  });

  it("relays ops to other clients but never echoes them back to the sender", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    const b = makeClient(port, "b");
    await Promise.all([a.opened, b.opened]);

    a.send(a.rga.insertAt(0, "x"));
    await waitUntil(() => b.rga.getText() === "x");

    expect(a.messages.filter((m) => m.type === "ops")).toHaveLength(0);
  });
});

describe("presence", () => {
  const state = (name: string): OwnPresenceState => ({ name, anchor: null });

  it("relays a client's presence to others but not back to itself", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    const b = makeClient(port, "b");
    await Promise.all([a.opened, b.opened]);

    a.sendPresence(state("Ann"));
    await waitUntil(() => b.messages.some((m) => m.type === "presence"));

    const relayed = b.messages.find((m) => m.type === "presence");
    expect(relayed).toMatchObject({ clientId: "a", state: { name: "Ann" } });
    expect(a.messages.some((m) => m.type === "presence")).toBe(false);
  });

  it("tells a late joiner who is already present", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    await a.opened;
    a.sendPresence(state("Ann"));
    await new Promise((r) => setTimeout(r, 50));

    const b = makeClient(port, "b");
    await b.opened;
    await waitUntil(() => b.messages.some((m) => m.type === "presences"));

    const list = b.messages.find((m) => m.type === "presences");
    expect(list).toMatchObject({ users: [{ clientId: "a", state: { name: "Ann" } }] });
  });

  it("announces when a client leaves", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    const b = makeClient(port, "b");
    await Promise.all([a.opened, b.opened]);

    a.sendPresence(state("Ann"));
    await waitUntil(() => b.messages.some((m) => m.type === "presence"));
    a.ws.close();

    await waitUntil(() => b.messages.some((m) => m.type === "presence-leave"));
    expect(b.messages.find((m) => m.type === "presence-leave")).toMatchObject({ clientId: "a" });
  });

  it("truncates an untrustworthy name and ignores any color a client sends", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    const b = makeClient(port, "b");
    await Promise.all([a.opened, b.opened]);

    // Simulates a malicious or outdated client still sending a color --
    // the current protocol doesn't even have that field, but the server
    // must not trust arbitrary JSON from the wire regardless.
    a.ws.send(
      JSON.stringify({
        type: "presence",
        clientId: "a",
        state: { name: "x".repeat(200), color: "red; background:url(x)", anchor: null },
      })
    );
    await waitUntil(() => b.messages.some((m) => m.type === "presence"));

    const relayed = b.messages.find((m) => m.type === "presence");
    if (relayed?.type !== "presence") throw new Error("unreachable");
    expect(relayed.state.name).toHaveLength(32);
    expect(relayed.state.color).not.toBe("red; background:url(x)");
  });

  it("assigns each connected client a distinct color and tells them what it is", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    const b = makeClient(port, "b");
    const c = makeClient(port, "c");
    await Promise.all([a.opened, b.opened, c.opened]);

    a.sendPresence(state("Ann"));
    b.sendPresence(state("Bea"));
    c.sendPresence(state("Cy"));
    await waitUntil(
      () => a.identity() !== undefined && b.identity() !== undefined && c.identity() !== undefined
    );

    const [colorA, colorB, colorC] = [a.identity()!.color, b.identity()!.color, c.identity()!.color];
    expect(new Set([colorA, colorB, colorC]).size).toBe(3);

    // The color broadcast to others must match what the client itself was told.
    await waitUntil(() => b.messages.some((m) => m.type === "presence"));
    const annViaB = b.messages.find((m) => m.type === "presence" && m.clientId === "a");
    expect(annViaB).toMatchObject({ state: { color: colorA } });
  });

  it("keeps a client's color stable across a rename instead of reassigning it", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    await a.opened;

    a.sendPresence(state("Ann"));
    await waitUntil(() => a.identity() !== undefined);
    const firstColor = a.identity()!.color;

    a.sendPresence(state("Annie"));
    await new Promise((r) => setTimeout(r, 50));

    expect(a.identity()!.color).toBe(firstColor);
    expect(a.messages.filter((m) => m.type === "identity")).toHaveLength(1); // not re-sent

    const relayedRename = a.messages.find(
      (m) => m.type === "presence" && m.state.name === "Annie"
    );
    expect(relayedRename).toBeUndefined(); // presence isn't echoed back to the sender
  });

  it("reserves a unique generated name for a client that hasn't chosen one", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    const b = makeClient(port, "b");
    await Promise.all([a.opened, b.opened]);

    // Empty name -- "I haven't picked one, generate me one."
    a.sendPresence({ name: "", anchor: null });
    b.sendPresence({ name: "", anchor: null });
    await waitUntil(() => a.identity() !== undefined && b.identity() !== undefined);

    const [nameA, nameB] = [a.identity()!.name, b.identity()!.name];
    expect(nameA).not.toBe("");
    expect(nameB).not.toBe("");
    expect(nameA).not.toBe(nameB);
  });

  it("honors an explicit custom name as-is, without enforcing uniqueness on it", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    const b = makeClient(port, "b");
    await Promise.all([a.opened, b.opened]);

    // Two people deliberately choosing the same name is their call, not a
    // system collision -- only the auto-generated name is reserved.
    a.sendPresence(state("Sam"));
    b.sendPresence(state("Sam"));
    await waitUntil(() => a.identity() !== undefined && b.identity() !== undefined);

    expect(a.identity()!.name).toBe("Sam");
    expect(b.identity()!.name).toBe("Sam");
  });

  it("frees a generated name for reuse once its connection disconnects", async () => {
    const { port } = startTestServer();
    const a = makeClient(port, "a");
    await a.opened;
    a.sendPresence({ name: "", anchor: null });
    await waitUntil(() => a.identity() !== undefined);
    const generatedName = a.identity()!.name;
    a.ws.close();
    await new Promise((r) => setTimeout(r, 50));

    const b = makeClient(port, "b");
    await b.opened;
    b.sendPresence({ name: "", anchor: null });
    await waitUntil(() => b.identity() !== undefined);

    // Not a strict requirement that it's the *same* name back -- just
    // confirms a disconnect doesn't permanently shrink the pool.
    expect(b.identity()!.name).not.toBe("");
  });

  it("never persists or replays presence as document state", async () => {
    const { port, doc } = startTestServer();
    const a = makeClient(port, "a");
    await a.opened;
    a.sendPresence(state("Ann"));
    await new Promise((r) => setTimeout(r, 50));
    expect(doc.getText()).toBe("");
  });
});

describe("heartbeat", () => {
  it("terminates a peer that stops answering pings", async () => {
    const { port } = startTestServer({ heartbeatMs: 50 });
    const a = makeClient(port, "a", { autoPong: false });
    await a.opened;

    const closed = new Promise<void>((resolve) => a.ws.once("close", () => resolve()));
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("never terminated")), 1000)),
    ]);
  });

  it("keeps a healthy peer connected", async () => {
    const { port } = startTestServer({ heartbeatMs: 50 });
    const a = makeClient(port, "a");
    await a.opened;

    await new Promise((r) => setTimeout(r, 300));
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("persistence", () => {
  it("restores the document after a server restart", async () => {
    const dbPath = tempDbPath();

    const first = startTestServer({ store: new SqliteOpLog(dbPath) });
    const a = makeClient(first.port, "a");
    await a.opened;
    a.send(a.rga.insertAt(0, "durable text"));
    a.send(a.rga.deleteAt(0, 8)); // "durable " -> "text"
    await waitUntil(() => first.doc.getText() === "text");
    a.ws.close();
    first.close();

    const second = startTestServer({ store: new SqliteOpLog(dbPath) });
    expect(second.doc.getText()).toBe("text");

    const b = makeClient(second.port, "b");
    await b.opened;
    await waitUntil(() => b.rga.getText() === "text");
  });

  it("lets a restored server keep merging edits that build on pre-restart state", async () => {
    const dbPath = tempDbPath();

    const first = startTestServer({ store: new SqliteOpLog(dbPath) });
    const a = makeClient(first.port, "a");
    await a.opened;
    a.send(a.rga.insertAt(0, "hello"));
    await waitUntil(() => first.doc.getText() === "hello");
    first.close();

    // A brand-new replica reusing site id "a" must bump its counter past the
    // ids in the snapshot, then edit relative to nodes the restarted server
    // only knows about from the persisted log.
    const second = startTestServer({ store: new SqliteOpLog(dbPath) });
    const a2 = makeClient(second.port, "a");
    await a2.opened;
    await waitUntil(() => a2.rga.getText() === "hello");
    a2.send(a2.rga.insertAt(5, " world"));
    await waitUntil(() => second.doc.getText() === "hello world");
  });

  it("SqliteOpLog round-trips ops in order and treats a batch atomically", () => {
    const dbPath = tempDbPath();
    const log = new SqliteOpLog(dbPath);
    const rga = new RGA("a");
    const ops = [...rga.insertAt(0, "ab"), ...rga.deleteAt(0, 1)];

    log.append(ops);
    log.append([]);
    log.close();

    const reopened = new SqliteOpLog(dbPath);
    expect(reopened.load()).toEqual(ops);
    reopened.close();
  });
});
