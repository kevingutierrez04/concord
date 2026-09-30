import type { WebSocket } from "ws";

// 16 colors distinct enough to tell apart, and dark enough for white avatar
// text. Ownership of this list moved here (server) from the frontend: once
// the server assigns colors, the client just renders whatever string it's
// given and no longer needs its own copy.
export const COLOR_PALETTE = [
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
  "#1f8a70",
  "#2b6cb0",
  "#b7791f",
  "#822659",
  "#4a5568",
  "#c53030",
];

// 16 x 16 = 256 unique generated names before any suffix is needed. Unlike
// the color palette (deliberately small -- humans can't tell apart much more
// than ~15-20 hues at a glance), there's no equivalent perceptual ceiling
// for names, so this list can just be made as large as wanted.
const ADJECTIVES = [
  "Swift",
  "Quiet",
  "Brave",
  "Clever",
  "Gentle",
  "Bold",
  "Lucky",
  "Calm",
  "Merry",
  "Witty",
  "Nimble",
  "Cosmic",
  "Mighty",
  "Plucky",
  "Sunny",
  "Jolly",
];
const ANIMALS = [
  "Otter",
  "Falcon",
  "Panda",
  "Fox",
  "Heron",
  "Lynx",
  "Badger",
  "Wren",
  "Raven",
  "Moose",
  "Tiger",
  "Whale",
  "Rabbit",
  "Squirrel",
  "Dolphin",
  "Owl",
];

// Trims and caps a client-supplied name. Deliberately does NOT fall back to
// a placeholder for empty input -- an empty string is the signal
// PresenceNames.resolve() uses to mean "generate one for me."
export function sanitizeName(name: unknown): string {
  return String(name ?? "").trim().slice(0, 32);
}

// Assigns each connection a color unused by any other *currently connected*
// client, released back to the pool on disconnect. Keyed by the WebSocket
// itself (object identity), not a client id, so it doesn't care what
// protocol messages have or haven't arrived yet.
export class PresenceColors {
  private assigned = new Map<WebSocket, string>();

  // Returns the color for `ws`, assigning one on first call. `isNew` tells
  // the caller whether this is a fresh assignment the client needs to be
  // told about, or a repeat call that already has one (e.g. a rename).
  ensure(ws: WebSocket): { color: string; isNew: boolean } {
    const existing = this.assigned.get(ws);
    if (existing) return { color: existing, isNew: false };

    const taken = new Set(this.assigned.values());
    const free = COLOR_PALETTE.find((c) => !taken.has(c));
    // Pool exhausted (more concurrent editors than colors): cycle rather
    // than refuse a color. Collisions become possible again past this
    // point -- an accepted, documented limit of a fixed-size palette.
    const color = free ?? COLOR_PALETTE[taken.size % COLOR_PALETTE.length];

    this.assigned.set(ws, color);
    return { color, isNew: true };
  }

  release(ws: WebSocket): void {
    this.assigned.delete(ws);
  }
}

// Reserves a unique generated display name per connection, the same way
// PresenceColors reserves a color -- but only for names the client didn't
// choose itself. An explicit name (typed by the user, including a rename)
// is always honored as given; uniqueness is only enforced for the
// auto-generated starting name, since that's the case where a collision is
// the *system's* fault rather than two people's coincidence.
export class PresenceNames {
  private current = new Map<WebSocket, string>();
  private generatedTaken = new Set<string>();

  // `requested` is the client's current choice, already sanitized via
  // sanitizeName(); empty means "I haven't picked one, generate one."
  resolve(ws: WebSocket, requested: string): string {
    if (requested) {
      this.releaseGenerated(ws);
      this.current.set(ws, requested);
      return requested;
    }

    const existing = this.current.get(ws);
    if (existing) return existing;

    const generated = this.reserveGenerated();
    this.generatedTaken.add(generated);
    this.current.set(ws, generated);
    return generated;
  }

  release(ws: WebSocket): void {
    this.releaseGenerated(ws);
    this.current.delete(ws);
  }

  private releaseGenerated(ws: WebSocket): void {
    const previous = this.current.get(ws);
    if (previous) this.generatedTaken.delete(previous);
  }

  private reserveGenerated(): string {
    for (const adjective of ADJECTIVES) {
      for (const animal of ANIMALS) {
        const candidate = `${adjective} ${animal}`;
        if (!this.generatedTaken.has(candidate)) return candidate;
      }
    }
    // Pool exhausted (more than 256 concurrent unnamed guests): degrade to
    // a numbered fallback rather than refuse the connection a name.
    let n = this.generatedTaken.size + 1;
    while (this.generatedTaken.has(`Guest ${n}`)) n++;
    return `Guest ${n}`;
  }
}
