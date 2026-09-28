const PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#008080",
  "#9a6324",
  "#800000",
  "#808000",
  "#f032e6",
];

const ADJECTIVES = ["Swift", "Quiet", "Brave", "Clever", "Gentle", "Bold", "Lucky", "Calm"];
const ANIMALS = ["Otter", "Falcon", "Panda", "Fox", "Heron", "Lynx", "Badger", "Wren"];

// Stable per-id color so a user looks the same to everyone, with no
// coordination needed.
export function colorFor(id: string): string {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return PALETTE[(hash >>> 0) % PALETTE.length];
}

export function randomName(random: () => number = Math.random): string {
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)];
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}
