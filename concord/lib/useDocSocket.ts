"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RGA, type Op } from "../../crdt/src/rga";
import type { ClientMessage, ServerMessage } from "./protocol";
import { computeTextDiff } from "./textDiff";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001";
const CLIENT_ID_KEY = "concord-client-id";

function getClientId(): string {
  if (typeof window === "undefined") return "server";
  const existing = window.sessionStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

interface CursorRange {
  start: number;
  end: number;
}

export function useDocSocket() {
  const [content, setContent] = useState("");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const rgaRef = useRef<RGA | null>(null);
  const clientIdRef = useRef<string>("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCursorRef = useRef<CursorRange | null>(null);

  useEffect(() => {
    const clientId = getClientId();
    clientIdRef.current = clientId;
    rgaRef.current = new RGA(clientId);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);

      if (message.type === "snapshot") {
        const fresh = new RGA(clientIdRef.current);
        for (const op of message.ops) fresh.applyOp(op);
        rgaRef.current = fresh;
        setContent(fresh.getText());
        return;
      }

      const rga = rgaRef.current;
      if (!rga) return;
      applyRemoteOps(rga, message.ops, textareaRef.current, pendingCursorRef);
      setContent(rga.getText());
    };

    return () => ws.close();
  }, []);

  // Restores the cursor position computed while applying remote ops.
  // Runs after every content-driven render, but only acts when a remote
  // update actually set a pending position -- local edits leave the
  // browser's own cursor placement alone.
  useLayoutEffect(() => {
    const pending = pendingCursorRef.current;
    const textarea = textareaRef.current;
    if (pending && textarea) {
      textarea.selectionStart = pending.start;
      textarea.selectionEnd = pending.end;
      pendingCursorRef.current = null;
    }
  }, [content]);

  const edit = useCallback((next: string) => {
    const rga = rgaRef.current;
    const ws = wsRef.current;
    if (!rga) return;

    const diff = computeTextDiff(rga.getText(), next);
    const ops: Op[] = [];
    if (diff.deleteCount > 0) ops.push(...rga.deleteAt(diff.index, diff.deleteCount));
    if (diff.insertText.length > 0) ops.push(...rga.insertAt(diff.index, diff.insertText));

    setContent(rga.getText());

    if (ops.length > 0 && ws && ws.readyState === ws.OPEN) {
      const message: ClientMessage = { type: "ops", ops };
      ws.send(JSON.stringify(message));
    }
  }, []);

  return { content, edit, connected, textareaRef };
}

// Applies a batch of remote ops and computes where the local cursor should
// end up. Each op moves exactly one character, so the cursor only ever
// shifts by one per op: forward past an insert at or before it, back past
// a delete strictly before it.
function applyRemoteOps(
  rga: RGA,
  ops: Op[],
  textarea: HTMLTextAreaElement | null,
  pendingCursorRef: React.RefObject<CursorRange | null>
): void {
  let cursor = textarea ? textarea.selectionStart : null;

  for (const op of ops) {
    if (op.type === "insert") {
      rga.applyOp(op);
      const idx = rga.visibleIndexOf(op.id);
      if (idx !== null && cursor !== null && idx <= cursor) cursor++;
    } else {
      const idx = rga.visibleIndexOf(op.id);
      rga.applyOp(op);
      if (idx !== null && cursor !== null && idx < cursor) cursor--;
    }
  }

  if (cursor !== null) {
    pendingCursorRef.current = { start: cursor, end: cursor };
  }
}
