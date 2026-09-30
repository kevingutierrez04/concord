// First letter of the first and last word, for an avatar chip.
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words[words.length - 1][0];
  return (words.length > 1 ? first + last : first).toUpperCase();
}
