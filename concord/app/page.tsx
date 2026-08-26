"use client";

import { useDocSocket } from "@/lib/useDocSocket";

export default function Home() {
  const { content, edit, connected, textareaRef } = useDocSocket();

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-1 flex-col gap-4 px-8 py-16">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
            concord
          </h1>
          <span
            className={`flex items-center gap-2 text-sm ${
              connected
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                connected ? "bg-emerald-500" : "bg-red-500"
              }`}
            />
            {connected ? "connected" : "disconnected"}
          </span>
        </div>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => edit(e.target.value)}
          placeholder="Start typing... open this page in another tab to see it sync."
          className="min-h-[60vh] w-full resize-none rounded-lg border border-zinc-200 bg-white p-4 font-mono text-sm text-black outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
        />
      </main>
    </div>
  );
}
