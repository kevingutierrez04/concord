"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { DocClient, type RemotePresence } from "./docClient";
import { colorFor, randomName } from "./identity";
import { computeTextDiff } from "./textDiff";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4001";
const CLIENT_ID_KEY = "concord-client-id";
const NAME_KEY = "concord-display-name";

function getClientId(): string {
  if (typeof window === "undefined") return "server";
  const existing = window.sessionStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

function getStoredName(): string {
  const existing = window.sessionStorage.getItem(NAME_KEY);
  if (existing !== null) return existing;
  const name = randomName();
  window.sessionStorage.setItem(NAME_KEY, name);
  return name;
}

interface Identity {
  name: string;
  color: string;
}

// The display name lives in sessionStorage, an external store, so it is read
// with useSyncExternalStore: the server render gets a blank identity and the
// client swaps in the stored one after hydration without a mismatch.
const SERVER_IDENTITY: Identity = { name: "", color: "#888888" };
const identityListeners = new Set<() => void>();
let cachedIdentity = SERVER_IDENTITY;

function subscribeIdentity(listener: () => void): () => void {
  identityListeners.add(listener);
  return () => identityListeners.delete(listener);
}

function getIdentitySnapshot(): Identity {
  const name = getStoredName();
  const color = colorFor(getClientId());
  if (cachedIdentity.name !== name || cachedIdentity.color !== color) {
    cachedIdentity = { name, color };
  }
  return cachedIdentity;
}

function getServerIdentitySnapshot(): Identity {
  return SERVER_IDENTITY;
}

interface CursorRange {
  start: number;
  end: number;
}

export function useDocSocket() {
  const [content, setContent] = useState("");
  const [connected, setConnected] = useState(false);
  const [presences, setPresences] = useState<RemotePresence[]>([]);
  const me = useSyncExternalStore(
    subscribeIdentity,
    getIdentitySnapshot,
    getServerIdentitySnapshot
  );
  const clientRef = useRef<DocClient | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCursorRef = useRef<CursorRange | null>(null);

  useEffect(() => {
    const clientId = getClientId();
    const client = new DocClient(clientId, () => new WebSocket(WS_URL), {
      onLocalChange: (text) => setContent(text),
      onConnectedChange: (isConnected) => setConnected(isConnected),
      onPresenceChange: (users) => setPresences(users),
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

    const identity = getIdentitySnapshot();
    client.setIdentity(identity.name.trim() || "anonymous", identity.color);

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

  const setName = useCallback((name: string) => {
    window.sessionStorage.setItem(NAME_KEY, name);
    identityListeners.forEach((listener) => listener());
    clientRef.current?.setIdentity(name.trim() || "anonymous", colorFor(getClientId()));
  }, []);

  const reportCursor = useCallback((index: number) => {
    clientRef.current?.setCursor(index);
  }, []);

  return { content, edit, connected, textareaRef, presences, me, setName, reportCursor };
}
