# concord

A simplified real-time collaborative text editor. Multiple people edit one document at the same time, see each other's cursors, survive disconnects without losing work, and never need a "who wins" merge — conflicts are resolved by a sequence CRDT (an RGA) that I implemented from scratch rather than pulling in Yjs or Automerge.

- **Real-time sync** over WebSockets, operation-based
- **Conflict-free merging** of concurrent, out-of-order, and duplicated edits
- **Presence:** who's online, and each person's live cursor, tracked correctly through concurrent edits
- **Offline / reconnect:** keep typing while disconnected; everything reconciles on reconnect with no loss or duplication
- **Persistence:** the document survives server restarts (SQLite)

## Architecture

Three folders, deployed and run as two services:

```
concord/   Next.js frontend.
server/    Node/TypeScript backend. Owns the WebSocket server, the shared
           document state, and persistence. Deployable to
           any long-running Node host (Render/Fly/Railway/local) — NOT Vercel serverless functions, which don't support long-lived WebSocket connections.
crdt/      The RGA implementation and its tests. Plain TypeScript with no
           dependencies, imported by both concord/ and server/ via relative paths.
```

```
 browser tab ──┐                              ┌── SQLite op log
 browser tab ──┼── WebSocket ── server/ ──────┤
 browser tab ──┘   (ops, presence)  (authoritative RGA replica)
   each holds its own RGA replica
```

Every participant — each browser tab and the server — holds a full replica of the document as an RGA. Edits become small operations that are applied locally first (so typing never waits on the network), sent to the server, and relayed to everyone else. Because the RGA merge is deterministic, every replica ends up identical no matter what order operations arrive in.

**Why split instead of a Next.js custom server:**
keeping the frontend as a stock Next.js app preserves Vercel as a deploy target and keeps frontend/
backend concerns and lifecycles independent — closer to how a real client-server collaborative system is structured.

**Why `ws` over Socket.IO:** Socket.IO layers reconnection, rooms, and fallback transports on top of raw WebSockets.
Reconnection/resync and the multi-client sync protocol are things I wanted to build so the backend uses the bare
`ws` library and hand-rolls reconnect/resync logic.

**Single shared document:** no doc list, routing, or picker. Keeps every non-CRDT surface (server-side doc lookup, frontend routing) minimal so implementation time stays on the CRDT core.

## The CRDT

`crdt/src/rga.ts` implements a Replicated Growable Array. Each character is a node with a small fixed-size id (`{counter, siteId}`) and a pointer to the id of the character it was inserted after. Concurrent inserts at the same spot are ordered by a deterministic id comparison, so all replicas agree.

Key design choices and their tradeoffs:

| Decision | Choice | Why / cost |
| --- | --- | --- |
| Algorithm | RGA over Logoot | Ids never grow with edit history (Logoot's position identifiers grow when many inserts land between the same neighbors — exactly what typing a sentence does). Cost: position lookup is O(n) without an index, and concurrent same-spot inserts can interleave in a surprising-but-convergent order. |
| Deletes | Tombstones, never garbage-collected | Simplest correct approach. Safe GC needs to know every replica has seen a delete (vector clocks). Cost: memory grows with total edit history. |
| Out-of-order delivery | Buffer ops until their dependency arrives | An insert can't be placed before the character it points at exists; a delete can't hit a character that hasn't arrived. Buffered ops replay automatically. |
| Duplicates | Idempotent apply | A resent op is a no-op, so retransmission is always safe. |

## Sync, server role, and persistence

- **Op-based sync.** Each edit is sent as insert/delete operations, not the whole document. A new or reconnecting client receives a full snapshot of the server's state (every node id and tombstone) and merges it into what it already has.
- **The server is an authoritative replica, not a relay.** It applies every op with the same code a browser runs, which gives late joiners something to bootstrap from and gives persistence a canonical state to save.
- **Concurrency on the server.** A batch of ops is applied, persisted, then broadcast inside one synchronous handler. Node's single-threaded event loop makes that a critical section for free — two clients' batches can never interleave mid-apply. (On a multi-threaded server the shared replica would need an explicit lock; it's also why the SQLite driver is the synchronous `better-sqlite3` — an async driver would open a gap between "applied" and "durable" where another batch could slip in.)
- **Persistence.** The server appends every op batch to a SQLite op log (one transaction per batch, WAL mode) and replays it through the same `applyOp` on startup. Replay is safe precisely because applying ops is idempotent and order-independent.

## Presence

Cursors are sent as an **anchor** — the id of the character to the left of the caret — not a numeric index. A raw index goes stale the instant someone else types before it; an anchor keeps pointing at the same place in the document and is resolved back to an index each time it's drawn. Presence is ephemeral: relayed by the server but never stored in the CRDT or the op log, and cleared when someone disconnects. A heartbeat (ping/pong) reaps connections that vanish without closing, so the "who's here" list doesn't fill with ghosts.

## Reconnection and offline editing

Edits are applied locally regardless of connection state. On every (re)connect the client receives the server's snapshot, merges it into its existing replica (never replacing it), then diffs its own full state against the snapshot and sends whatever the server is missing. Because that's a state comparison rather than a send-queue, it covers both edits made while offline **and** edits that were mid-flight when a socket died — no per-op acknowledgements needed. Reconnects retry on a fixed 1s interval.

## Testing

Concurrency is the hard part of this project, so it's tested at three levels:

| Suite | What it proves |
| --- | --- |
| `crdt/` | The algorithm in isolation, including a property-based test (`fast-check`, 100 random runs) that generates random concurrent edits across 3 replicas, delivers them in random order, and asserts every replica converges. |
| `server/` | Real `ws` clients against a real in-process server: concurrent inserts/deletes converge, late joiners bootstrap, ops aren't echoed to senders, presence relays/sanitizes/expires, dead peers are reaped, and the document survives a restart. |
| `concord/` | The client's reconnect, reconcile, and presence logic against a fake socket with fake timers — including ops lost mid-flight and deletes the server missed. |

I also drove the running app with a headless browser (Playwright, not committed): two tabs typing simultaneously, remote caret rendering, a server kill mid-edit with both tabs editing offline, then restart — everything converged with no lost characters.

```bash
cd crdt    && npm test
cd server  && npm test
cd concord && npm test
```

## Running locally

Two terminals:

```bash
# terminal 1 — backend
cd server
npm install
npm run dev        # ws server on ws://localhost:4001, SQLite at server/concord.db

# terminal 2 — frontend
cd concord
npm install
npm run dev         # Next.js on http://localhost:3000
```

Open `http://localhost:3000` in two browser tabs (each tab gets its own ephemeral client id and generated name) to see edits and cursors sync between them. Server settings: `PORT` (default 4001), `DB_PATH` (default `concord.db`). Frontend: `NEXT_PUBLIC_WS_URL` (default `ws://localhost:4001`), see `concord/.env.local.example`.

## Deploying

- **Server** — needs a host that supports long-lived WebSocket connections **and a persistent disk** for the SQLite file. A `Dockerfile` is at the repo root; build from the repo root (the server imports `../crdt`): `docker build -t concord-server .`, and mount a volume at `/data`.
- **Frontend** — a standard Next.js app (Vercel works). Set `NEXT_PUBLIC_WS_URL` to the server's `wss://` URL. Because it imports `../crdt`, enable "include source files outside the root directory" if your host builds from `concord/` only.

## Known limitations and what I'd do with more time

- **Tombstones are never collected**, so memory and snapshot size grow with edit history. Fix: track causal stability (vector clocks) and compact once every replica has seen a delete.
- **Snapshot on every connect is O(document).** Fine here; at scale I'd send only the ops a client is missing, using a version vector.
- **RGA can interleave concurrent same-position typing** (both users' runs mix character-by-character in some cases). It always converges, but Fugue/YATA-style algorithms avoid it.
- **Presence shows carets, not selections**, and cursor updates aren't throttled.
- **O(n) position lookups** in the RGA; a balanced tree or skip list over nodes would make edits O(log n).
- **Fixed reconnect delay** rather than exponential backoff with jitter.
- **One document, no auth** — by design, to keep scope on the CRDT.
- **The Dockerfile hasn't been built** in the environment I developed in (no Docker daemon there), and nothing is deployed yet.
