"use client";

import { useRef } from "react";
import { useDocSocket } from "@/lib/useDocSocket";
import { initialsFor } from "@/lib/identity";
import { EDITOR_TEXT_CLASSES, RemoteCarets } from "./RemoteCarets";

function Logo() {
  return (
    <span
      aria-hidden
      className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600"
    >
      <span className="absolute h-2 w-2 -translate-x-1.5 rounded-full bg-white/80" />
      <span className="absolute h-2 w-2 translate-y-1.5 rounded-full bg-white/80" />
      <span className="absolute h-2 w-2 translate-x-1.5 -translate-y-1.5 rounded-full bg-white/90" />
    </span>
  );
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      title={name}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white dark:ring-zinc-950"
      style={{ backgroundColor: color }}
    >
      {initialsFor(name)}
    </span>
  );
}

export default function Home() {
  const { content, edit, connected, textareaRef, presences, me, setName, reportCursor } =
    useDocSocket();
  const mirrorRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 font-sans dark:bg-zinc-950 sm:p-8">
      <main className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Logo />
            <h1 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              concord
            </h1>
          </div>
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              connected
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
                : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
            }`}
          >
            <span className="relative flex h-1.5 w-1.5">
              {connected && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-rose-500"}`}
              />
            </span>
            {connected ? "connected" : "disconnected"}
          </span>
        </div>

        <div
          className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-zinc-50/60 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950/40"
          data-testid="presence-bar"
        >
          <div className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white py-0.5 pl-0.5 pr-2.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <Avatar name={me.name} color={me.color} />
            <input
              aria-label="Your display name"
              value={me.name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              className="w-28 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-zinc-900 outline-none transition-colors hover:border-zinc-200 focus:border-zinc-300 focus:bg-zinc-50 dark:text-zinc-100 dark:hover:border-zinc-700 dark:focus:border-zinc-600 dark:focus:bg-zinc-800"
            />
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              you
            </span>
          </div>
          {presences.length > 0 && (
            <>
              <span className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
              <div className="flex flex-wrap items-center gap-2">
                {presences.map((user) => (
                  <span
                    key={user.clientId}
                    data-testid="presence-user"
                    className="flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <Avatar name={user.name} color={user.color} />
                    {user.name}
                  </span>
                ))}
              </div>
            </>
          )}
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
            placeholder="Start typing… open this page in another tab to see it sync."
            className={`block min-h-[55vh] w-full resize-none border-transparent bg-transparent text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-50 dark:placeholder:text-zinc-600 ${EDITOR_TEXT_CLASSES}`}
          />
          <RemoteCarets text={content} users={presences} mirrorRef={mirrorRef} />
        </div>
      </main>
    </div>
  );
}
