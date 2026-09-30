import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RGA, type Op } from "../../crdt/src/rga";
import { DocClient, type DocClientHandlers, type RemotePresence } from "./docClient";
import type { ServerMessage } from "./protocol";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: unknown[] = [];

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = this.OPEN;
    this.onopen?.();
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = this.CLOSED;
    this.onclose?.();
  }

  receive(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function sentOps(ws: FakeWebSocket): { type: string; ops: unknown[] }[] {
  return ws.sent.filter((m) => (m as { type: string }).type === "ops") as {
    type: string;
    ops: unknown[];
  }[];
}

function sentPresence(ws: FakeWebSocket) {
  return ws.sent.filter((m) => (m as { type: string }).type === "presence");
}

function makeHandlers() {
  const events: string[] = [];
  let presences: RemotePresence[] = [];
  let myColor: string | undefined;
  let myName: string | undefined;
  const handlers: DocClientHandlers = {
    onLocalChange: (text) => events.push(`local:${text}`),
    onRemoteChange: (text) => events.push(`remote:${text}`),
    onConnectedChange: (connected) => events.push(`connected:${connected}`),
    onPresenceChange: (users) => {
      presences = users;
    },
    onIdentityAssigned: (name, color) => {
      myName = name;
      myColor = color;
    },
  };
  return {
    handlers,
    events,
    getPresences: () => presences,
    getMyColor: () => myColor,
    getMyName: () => myName,
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DocClient", () => {
  it("applies local edits immediately regardless of connection state", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();

    client.edit("hello");

    expect(client.getText()).toBe("hello");
    // not connected yet, so nothing should have been sent
    expect(FakeWebSocket.instances[0].sent).toEqual([]);
  });

  it("sends ops made while offline once the server's snapshot arrives", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();

    client.edit("hi");
    const ws = FakeWebSocket.instances[0];
    ws.open();
    // server always sends a snapshot on connect; that's what triggers flush
    ws.receive({ type: "snapshot", ops: [] });

    expect(sentOps(ws)).toHaveLength(1);
  });

  it("reconnects automatically after the socket closes", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient(
      "a",
      () => new FakeWebSocket() as unknown as WebSocket,
      handlers,
      1000
    );
    client.start();
    expect(FakeWebSocket.instances.length).toBe(1);

    FakeWebSocket.instances[0].close();
    expect(FakeWebSocket.instances.length).toBe(1); // no immediate reconnect

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it("does not reconnect after stop() is called", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient(
      "a",
      () => new FakeWebSocket() as unknown as WebSocket,
      handlers,
      1000
    );
    client.start();
    client.stop();
    FakeWebSocket.instances[0].close();

    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it("preserves edits made while disconnected and merges them with what happened on the server", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();

    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.receive({ type: "snapshot", ops: [] });

    client.edit("local");
    expect(sentOps(ws1)).toHaveLength(1); // sent immediately, connected

    // simulate going offline mid-edit
    ws1.close();
    client.edit("local!"); // queued, not sent -- socket is closed

    // reconnect
    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();

    // meanwhile, another site made edits that only exist in the server's
    // snapshot -- simulated here as a second replica's ops
    const other = new RGA("b");
    const remoteOps = other.insertAt(0, "server-side ");
    ws2.receive({ type: "snapshot", ops: remoteOps });

    // both the offline edit and the remote edit must survive
    expect(client.getText()).toContain("local!");
    expect(client.getText()).toContain("server-side");

    // the offline edit must have been sent on the new connection
    expect(sentOps(ws2)).toHaveLength(1);
  });

  it("re-sends ops that were mid-flight when the socket died", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();

    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.receive({ type: "snapshot", ops: [] });

    // send() "succeeds" locally, but the connection dies before the server
    // ever sees it -- the server's next snapshot won't include this op.
    client.edit("lost?");
    expect(sentOps(ws1)).toHaveLength(1);
    ws1.close();

    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();
    ws2.receive({ type: "snapshot", ops: [] });

    const resent = sentOps(ws2);
    expect(resent).toHaveLength(1);
    expect(resent[0].ops).toHaveLength("lost?".length);
  });

  it("does not re-send ops the server already has", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();

    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.receive({ type: "snapshot", ops: [] });
    client.edit("kept");
    const delivered = (sentOps(ws1)[0].ops as Op[]);
    ws1.close();

    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();
    ws2.receive({ type: "snapshot", ops: delivered });

    expect(sentOps(ws2)).toHaveLength(0);
  });

  it("re-sends deletes the server missed, not just inserts", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();

    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.receive({ type: "snapshot", ops: [] });
    client.edit("abc");
    const inserts = sentOps(ws1)[0].ops as Op[];
    ws1.close();
    client.edit("ac"); // offline delete of "b"

    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();
    ws2.receive({ type: "snapshot", ops: inserts }); // server has inserts only

    const resent = sentOps(ws2);
    expect(resent).toHaveLength(1);
    expect(resent[0].ops).toEqual([{ type: "delete", id: inserts[1].id }]);
  });
});

describe("DocClient presence", () => {
  const remote = (name: string, anchor: Op["id"] | null) => ({
    name,
    color: "#ff0000",
    anchor,
  });

  it("tracks remote users from the initial list, updates, and departures", () => {
    const { handlers, getPresences } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    ws.receive({ type: "presences", users: [{ clientId: "b", state: remote("Bea", null) }] });
    expect(getPresences().map((u) => u.name)).toEqual(["Bea"]);

    ws.receive({ type: "presence", clientId: "c", state: remote("Cy", null) });
    expect(getPresences().map((u) => u.name)).toEqual(["Bea", "Cy"]);

    ws.receive({ type: "presence-leave", clientId: "b" });
    expect(getPresences().map((u) => u.name)).toEqual(["Cy"]);
  });

  it("ignores its own entry in the presence list", () => {
    const { handlers, getPresences } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    ws.receive({ type: "presences", users: [{ clientId: "a", state: remote("me", null) }] });
    expect(getPresences()).toEqual([]);
  });

  it("clears remote presence on disconnect", () => {
    const { handlers, getPresences } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive({ type: "presence", clientId: "b", state: remote("Bea", null) });

    ws.close();
    expect(getPresences()).toEqual([]);
  });

  it("keeps a remote caret at the same spot in the text as edits land before it", () => {
    const { handlers, getPresences } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    const peer = new RGA("b");
    const initial = peer.insertAt(0, "world");
    ws.receive({ type: "snapshot", ops: initial });
    const anchor = peer.anchorAt(2); // between "wo" and "rld"
    ws.receive({ type: "presence", clientId: "b", state: remote("Bea", anchor) });
    expect(getPresences()[0].index).toBe(2);

    client.edit("hello world"); // local insert of "hello " before the caret
    expect(getPresences()[0].index).toBe(8);
  });

  it("reports a null caret index until the anchored character arrives", () => {
    const { handlers, getPresences } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    const peer = new RGA("b");
    const ops = peer.insertAt(0, "x");
    ws.receive({ type: "presence", clientId: "b", state: remote("Bea", ops[0].id) });
    expect(getPresences()[0].index).toBeNull();

    ws.receive({ type: "ops", ops });
    expect(getPresences()[0].index).toBe(1);
  });

  it("sends the local cursor as an anchor, and re-announces itself after a reconnect", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();
    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.receive({ type: "snapshot", ops: [] });
    client.setIdentity("Ann");
    client.edit("hi");
    client.setCursor(1);

    const last = sentPresence(ws1).at(-1) as { state: { name: string; anchor: unknown } };
    expect(last.state.name).toBe("Ann");
    expect(last.state.anchor).not.toBeNull();
    ws1.close();

    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();
    ws2.receive({ type: "snapshot", ops: [] });

    const announced = sentPresence(ws2);
    expect(announced).toHaveLength(1);
    expect((announced[0] as { state: { name: string } }).state.name).toBe("Ann");
  });

  it("never sends a color -- the server assigns one, delivered via an 'identity' message", () => {
    const { handlers, getMyColor } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive({ type: "snapshot", ops: [] });
    client.setIdentity("Ann");

    const sent = sentPresence(ws).at(-1) as { state: Record<string, unknown> };
    expect(sent.state).not.toHaveProperty("color");
    expect(getMyColor()).toBeUndefined();

    ws.receive({ type: "identity", name: "Ann", color: "#4363d8" });
    expect(getMyColor()).toBe("#4363d8");
  });

  it("asks the server to generate a name when setIdentity is called with none", () => {
    const { handlers, getMyName } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.receive({ type: "snapshot", ops: [] });
    client.setIdentity(""); // no stored name yet -- ask the server for one

    const sent = sentPresence(ws).at(-1) as { state: { name: string } };
    expect(sent.state.name).toBe("");
    expect(getMyName()).toBeUndefined();

    ws.receive({ type: "identity", name: "Swift Otter", color: "#4363d8" });
    expect(getMyName()).toBe("Swift Otter");
  });

  it("remembers a server-generated name so a reconnect doesn't ask to generate a new one", () => {
    const { handlers } = makeHandlers();
    const client = new DocClient("a", () => new FakeWebSocket() as unknown as WebSocket, handlers);
    client.start();
    const ws1 = FakeWebSocket.instances[0];
    ws1.open();
    ws1.receive({ type: "snapshot", ops: [] });
    client.setIdentity("");
    ws1.receive({ type: "identity", name: "Swift Otter", color: "#4363d8" });

    ws1.close();
    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    ws2.open();
    ws2.receive({ type: "snapshot", ops: [] });

    const sent = sentPresence(ws2).at(-1) as { state: { name: string } };
    expect(sent.state.name).toBe("Swift Otter"); // not "" again
  });
});
