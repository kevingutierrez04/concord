import type { Ref } from "react";
import type { RemotePresence } from "@/lib/docClient";

// Shared by the textarea and the overlay so both wrap text identically.
export const EDITOR_TEXT_CLASSES =
  "p-4 font-mono text-sm leading-6 whitespace-pre-wrap break-words [scrollbar-gutter:stable] border";

interface Props {
  text: string;
  users: RemotePresence[];
  mirrorRef: Ref<HTMLDivElement>;
}

// A <textarea> can't render other people's carets, so this draws them in an
// invisible copy of the same text laid exactly over it.
export function RemoteCarets({ text, users, mirrorRef }: Props) {
  const carets = users
    .filter((user): user is RemotePresence & { index: number } => user.index !== null)
    .map((user) => ({ ...user, index: Math.min(user.index, text.length) }))
    .sort((a, b) => a.index - b.index);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const caret of carets) {
    parts.push(text.slice(cursor, caret.index));
    cursor = caret.index;
    parts.push(
      <span
        key={caret.clientId}
        data-testid="remote-caret"
        className="pointer-events-none relative inline-block h-6 w-0 align-bottom"
        style={{ borderLeft: `2px solid ${caret.color}` }}
      >
        <span
          className="absolute -top-3.5 left-0 whitespace-nowrap rounded px-1 text-[10px] leading-3 text-white"
          style={{ backgroundColor: caret.color }}
        >
          {caret.name}
        </span>
      </span>
    );
  }
  parts.push(text.slice(cursor));

  return (
    <div
      ref={mirrorRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden border-transparent text-transparent ${EDITOR_TEXT_CLASSES}`}
    >
      {parts}
      {"​"}
    </div>
  );
}
