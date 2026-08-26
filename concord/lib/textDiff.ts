export interface TextDiff {
  index: number;
  deleteCount: number;
  insertText: string;
}

// Finds the single contiguous changed region between two strings by
// matching the common prefix and common suffix and treating whatever's
// left in between as the change. Covers normal typing, backspacing, and
// paste; a textarea's onChange only ever hands us the resulting full
// string, not the edit that produced it, so this is how that edit gets
// recovered.
export function computeTextDiff(oldText: string, newText: string): TextDiff {
  let prefix = 0;
  const maxPrefix = Math.min(oldText.length, newText.length);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;

  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > prefix && newEnd > prefix && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  return {
    index: prefix,
    deleteCount: oldEnd - prefix,
    insertText: newText.slice(prefix, newEnd),
  };
}
