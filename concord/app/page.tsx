"use client";

import { useRef } from "react";
import { useDocSocket } from "@/lib/useDocSocket";
import { EDITOR_TEXT_CLASSES, RemoteCarets } from "./RemoteCarets";

export default function Home() {
  const { content, edit, connected, textareaRef, presences, me, setName, reportCursor } =
    useDocSocket();
  const mirrorRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-4 px-8 py-16">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">concord</h1>
          <span
            className={`flex items-center gap-2 text-sm ${
              connected
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
            />
            {connected ? "connected" : "disconnected"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="presence-bar">
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: me.color }} />
            <input
              aria-label="Your display name"
              value={me.name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              className="w-40 rounded border border-zinc-200 bg-white px-2 py-1 text-sm text-black dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
            <span>(you)</span>
          </label>
          {presences.map((user) => (
            <span
              key={user.clientId}
              data-testid="presence-user"
              className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-sm text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: user.color }} />
              {user.name}
            </span>
          ))}
        </div>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => {
              edit(e.target.value);
              reportCursor(e.target.selectionStart);
            }}
            onSelect={(e) => reportCursor(e.currentTarget.selectionStart)}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            placeholder="Start typing... open this page in another tab to see it sync."
            className={`block min-h-[60vh] w-full resize-none rounded-lg border-zinc-200 bg-white text-black outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 ${EDITOR_TEXT_CLASSES}`}
          />
          <RemoteCarets text={content} users={presences} mirrorRef={mirrorRef} />
        </div>
      </main>
    </div>
  );
}
