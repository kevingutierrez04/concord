"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "./protocol";

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

export function useDocSocket() {
  const [content, setContent] = useState("");
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const clientIdRef = useRef<string>("");

  useEffect(() => {
    clientIdRef.current = getClientId();
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const message: ServerMessage = JSON.parse(event.data);
      setContent(message.doc.content);
    };

    return () => ws.close();
  }, []);

  const edit = useCallback((next: string) => {
    setContent(next);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    const message: ClientMessage = {
      type: "update",
      content: next,
      clientId: clientIdRef.current,
      timestamp: Date.now(),
    };
    ws.send(JSON.stringify(message));
  }, []);

  return { content, edit, connected };
}
