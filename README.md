# concord

A simplified real-time collaborative text editor

## Architecture

Two independent services, deployed and run separately:

```
concord/   Next.js frontend.
server/    Node/TypeScript backend. Owns the WebSocket server, the shared
           document state, and persistence. Deployable to
           any long-running Node host (Render/Fly/Railway/local) — NOT Vercel serverless functions, which don't support long-lived WebSocket connections.
```

**Why split instead of a Next.js custom server:** 
keeping the frontend as a stock Next.js app preserves Vercel as a deploy target and keeps frontend/
backend concerns and lifecycles independent — closer to how a real client-server collaborative system is structured.

**Why `ws` over Socket.IO:** Socket.IO layers reconnection, rooms, and fallback transports on top of raw WebSockets. 
Reconnection/resync and the multi-client sync protocol are things I wanted to build so the backend uses the bare
`ws` library and hand-rolls reconnect/resync logic.

**Single shared document:** no doc list, routing, or picker. Keeps every non-CRDT surface (server-side doc lookup, frontend routing) minimal so implementation time stays on the CRDT core.

## Running locally

Two terminals:

```bash
# terminal 1 — backend
cd server
npm install
npm run dev        # ws server on ws://localhost:4001

# terminal 2 — frontend
cd concord
npm install
npm run dev         # Next.js on http://localhost:3000
```

Open `http://localhost:3000` in two browser tabs (each tab gets its own ephemeral client id) to see edits sync between them.