import { RGA, type NodeId, type Op } from "../../crdt/src/rga";
import type { ClientMessage, PresenceState, ServerMessage } from "./protocol";
import { computeTextDiff } from "./textDiff";

export interface RemotePresence {
  clientId: string;
  name: string;
  color: string;
  // Caret position in the current text, or null if the character the caret
  // is anchored to hasn't arrived here yet.
  index: number | null;
}

export interface DocClientHandlers {
  onLocalChange: (text: string) => void;
  onRemoteChange: (text: string, previousText: string) => void;
  onConnectedChange: (connected: boolean) => void;
  onPresenceChange?: (users: RemotePresence[]) => void;
  // Color is always server-assigned; name is server-assigned only if the
  // client didn't already choose one (see DocClient.setIdentity). Both
  // arrive together, asynchronously, after the first presence announcement.
  onIdentityAssigned?: (name: string, color: string) => void;
}

function opKey(op: Op): string {
  return `${op.type}:${op.id.counter}:${op.id.siteId}`;
}

export class DocClient {
  private readonly rga: RGA;
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  // Empty means "I haven't chosen a name" -- the server will generate a
  // unique one and tell us via the "identity" message.
  private localName = "";
  private localAnchor: NodeId | null = null;
  private remotePresence = new Map<string, PresenceState>();

  constructor(
    private readonly siteId: string,
    private readonly createSocket: () => WebSocket,
    private readonly handlers: DocClientHandlers,
    private readonly reconnectDelayMs = 1000
  ) {
    this.rga = new RGA(siteId);
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  getText(): string {
    return this.rga.getText();
  }

  getPresences(): RemotePresence[] {
    return [...this.remotePresence].map(([clientId, state]) => ({
      clientId,
      name: state.name,
      color: state.color,
      index: this.rga.indexOfAnchor(state.anchor),
    }));
  }

  setIdentity(name: string): void {
    this.localName = name;
    this.sendPresence();
  }

  // Cursor positions are sent as an anchor (the id of the character left of
  // the caret) rather than an index, so they stay correct as edits land.
  setCursor(index: number): void {
    this.localAnchor = this.rga.anchorAt(index);
    this.sendPresence();
  }

  edit(nextText: string): void {
    const previousText = this.rga.getText();
    const diff = computeTextDiff(previousText, nextText);

    const ops: Op[] = [];
    if (diff.deleteCount > 0) ops.push(...this.rga.deleteAt(diff.index, diff.deleteCount));
    if (diff.insertText.length > 0) ops.push(...this.rga.insertAt(diff.index, diff.insertText));

    this.handlers.onLocalChange(this.rga.getText());
    this.notifyPresence();

    // Fire and forget: if the socket is down, or dies with this in flight,
    // nothing is lost -- the op is already in this.rga, and reconcile()
    // re-sends whatever the server is missing on the next connection.
    if (ops.length > 0) this.sendOps(ops); // review
  }

  private connect(): void {
    const ws = this.createSocket();
    this.ws = ws;

    ws.onopen = () => this.handlers.onConnectedChange(true);

    // On a real disconnect, the browser/OS has already dropped the TCP
    // connection; nothing schedules a retry on its own, so we do it here.
    ws.onclose = () => {
      this.handlers.onConnectedChange(false);
      // Presence is only meaningful while connected; the server re-sends the
      // full list on reconnect.
      this.remotePresence.clear();
      this.notifyPresence();
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelayMs);
      }
    };

    ws.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data as string);

      if (message.type === "presences") {
        this.remotePresence = new Map(
          message.users
            .filter((user) => user.clientId !== this.siteId)
            .map((user) => [user.clientId, user.state])
        );
        this.notifyPresence();
        return;
      }
      if (message.type === "presence") {
        this.remotePresence.set(message.clientId, message.state);
        this.notifyPresence();
        return;
      }
      if (message.type === "presence-leave") {
        this.remotePresence.delete(message.clientId);
        this.notifyPresence();
        return;
      }
      if (message.type === "identity") {
        // Remember it so a later reconnect (or cursor-move presence ping)
        // resends the already-assigned name instead of asking to generate
        // a new one every time.
        this.localName = message.name;
        this.handlers.onIdentityAssigned?.(message.name, message.color);
        return;
      }

      const previousText = this.rga.getText();

      // Applied into the existing `this.rga`, never a fresh replica: on a
      // reconnect this replica may already hold local edits the server
      // never saw, which a fresh RGA would silently discard. applyOp is
      // idempotent and order-independent, so merging the server's snapshot
      // into whatever state already exists here is always safe, whether
      // this is the very first connection or a reconnect.
      for (const op of message.ops) this.rga.applyOp(op);

      const nextText = this.rga.getText();
      if (nextText !== previousText) {
        this.handlers.onRemoteChange(nextText, previousText);
      }
      this.notifyPresence();

      if (message.type === "snapshot") {
        this.reconcile(message.ops);
        this.sendPresence();
      }
    };
  }

  // Sends the server every op we hold that its snapshot didn't include.
  // Covers edits made while offline and edits that were mid-flight when a
  // socket died, without needing per-op acknowledgements.
  private reconcile(serverOps: Op[]): void {
    const serverHas = new Set(serverOps.map(opKey));
    const missing = this.rga.exportOps().filter((op) => !serverHas.has(opKey(op)));
    if (missing.length > 0) this.sendOps(missing);
  }

  private notifyPresence(): void {
    this.handlers.onPresenceChange?.(this.getPresences());
  }

  private sendOps(ops: Op[]): void {
    this.send({ type: "ops", ops });
  }

  private sendPresence(): void {
    this.send({
      type: "presence",
      clientId: this.siteId,
      state: { name: this.localName, anchor: this.localAnchor },
    });
  }

  private send(message: ClientMessage): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(message));
  }
}
