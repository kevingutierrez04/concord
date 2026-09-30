"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DocClient, type RemotePresence } from "./docClient";
import { computeTextDiff } from "./textDiff";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001";
const CLIENT_ID_KEY = "concord-client-id";
const NAME_KEY = "concord-display-name";

// Shown for the instant between connecting and the server's "identity"
// message arriving -- name and color are both server-assigned (see
// server/src/presence.ts), so neither can be known any earlier than that
// round trip. Both start blank/neutral, matching the server-rendered HTML,
// so there's nothing to reconcile on hydration.
const PENDING_COLOR = "#9ca3af";

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
  const [presences, setPresences] = useState<RemotePresence[]>([]);
  const [myColor, setMyColor] = useState(PENDING_COLOR);
  const [myName, setMyName] = useState("");
  const clientRef = useRef<DocClient | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCursorRef = useRef<CursorRange | null>(null);

  useEffect(() => {
    const clientId = getClientId();
    const client = new DocClient(clientId, () => new WebSocket(WS_URL), {
      onLocalChange: (text) => setContent(text),
      onConnectedChange: (isConnected) => setConnected(isConnected),
      onPresenceChange: (users) => setPresences(users),
      onIdentityAssigned: (assignedName, color) => {
        setMyName(assignedName);
        setMyColor(color);
        window.sessionStorage.setItem(NAME_KEY, assignedName);
      },
      onRemoteChange: (text, previousText) => {
        const textarea = textareaRef.current;
        if (textarea) {
          const diff = computeTextDiff(previousText, text);
          let cursor = textarea.selectionStart;
          if (cursor > diff.index + diff.deleteCount) {
            cursor += diff.insertText.length - diff.deleteCount;
          } else if (cursor > diff.index) {
            cursor = diff.index;
          }
          pendingCursorRef.current = { start: cursor, end: cursor };
        }
        setContent(text);
      },
    });
    clientRef.current = client;

    // An empty name tells the server "generate a unique one for me" (see
    // PresenceNames in server/src/presence.ts); a name already stored from
    // an earlier connection in this tab is sent as-is and just gets echoed
    // back via the same "identity" round trip, not regenerated. Either way
    // `myName` stays at its blank initial value (matching the server
    // render) until that reply lands -- same pattern as `myColor`.
    client.setIdentity(window.sessionStorage.getItem(NAME_KEY) ?? "");

    client.start();

    return () => client.stop();
  }, []);

  // Restores the cursor position computed from a remote change. Runs after
  // every content-driven render, but only acts when a remote update
  // actually set a pending position -- local edits leave the browser's own
  // cursor placement alone.
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
    clientRef.current?.edit(next);
  }, []);

  const setName = useCallback((nextName: string) => {
    setMyName(nextName); // always reflect what's typed, so the input stays controlled
    // An empty string sent to the server means "generate one for me" (see
    // DocClient.setIdentity) -- while the user is mid-edit (e.g. selected
    // all and deleted before typing a replacement), that would make a
    // fresh random name appear out from under them. Hold off sending until
    // there's real content; everyone else keeps seeing the last name you
    // had until then.
    if (nextName.trim().length === 0) return;
    window.sessionStorage.setItem(NAME_KEY, nextName);
    clientRef.current?.setIdentity(nextName);
  }, []);

  const reportCursor = useCallback((index: number) => {
    clientRef.current?.setCursor(index);
  }, []);

  return {
    content,
    edit,
    connected,
    textareaRef,
    presences,
    me: { name: myName, color: myColor },
    setName,
    reportCursor,
  };
}
