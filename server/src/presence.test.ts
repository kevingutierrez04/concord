import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { COLOR_PALETTE, PresenceColors, PresenceNames, sanitizeName } from "./presence.js";

// Map keys only need object identity, so a plain object stands in for a
// WebSocket connection here -- nothing about PresenceColors touches the
// socket itself.
function fakeSocket(): WebSocket {
  return {} as WebSocket;
}

describe("PresenceColors", () => {
  it("gives two different connections two different colors", () => {
    const colors = new PresenceColors();
    const a = colors.ensure(fakeSocket());
    const b = colors.ensure(fakeSocket());
    expect(a.color).not.toBe(b.color);
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(true);
  });

  it("returns the same color for the same connection every time, without re-flagging it as new", () => {
    const colors = new PresenceColors();
    const ws = fakeSocket();
    const first = colors.ensure(ws);
    const second = colors.ensure(ws);
    expect(second.color).toBe(first.color);
    expect(second.isNew).toBe(false);
  });

  it("assigns every color in the palette uniquely before any repeats", () => {
    const colors = new PresenceColors();
    const assigned = Array.from({ length: COLOR_PALETTE.length }, () =>
      colors.ensure(fakeSocket()).color
    );
    expect(new Set(assigned).size).toBe(COLOR_PALETTE.length);
  });

  it("frees a color on release so a later connection can reuse it", () => {
    const colors = new PresenceColors();
    const sockets = Array.from({ length: COLOR_PALETTE.length }, fakeSocket);
    const firstRound = sockets.map((ws) => colors.ensure(ws).color);

    colors.release(sockets[0]);
    const { color: reused } = colors.ensure(fakeSocket());

    expect(reused).toBe(firstRound[0]);
  });

  it("degrades to cycling through the palette once it's exhausted, rather than crashing", () => {
    const colors = new PresenceColors();
    for (let i = 0; i < COLOR_PALETTE.length; i++) colors.ensure(fakeSocket());
    const overflow = colors.ensure(fakeSocket());
    expect(COLOR_PALETTE).toContain(overflow.color);
  });
});

describe("sanitizeName", () => {
  it("trims and truncates, but leaves empty/missing input as empty", () => {
    expect(sanitizeName("Ann")).toBe("Ann");
    expect(sanitizeName("  Ann  ")).toBe("Ann");
    expect(sanitizeName("x".repeat(100))).toHaveLength(32);
    // Empty is the signal PresenceNames.resolve() uses to mean "generate
    // one" -- sanitizeName must not mask that with a fallback string.
    expect(sanitizeName("")).toBe("");
    expect(sanitizeName("   ")).toBe("");
    expect(sanitizeName(undefined)).toBe("");
    expect(sanitizeName(null)).toBe("");
  });
});

describe("PresenceNames", () => {
  it("reserves a unique generated name for each connection that asks for one", () => {
    const names = new PresenceNames();
    const a = names.resolve(fakeSocket(), "");
    const b = names.resolve(fakeSocket(), "");
    expect(a).not.toBe("");
    expect(b).not.toBe("");
    expect(a).not.toBe(b);
  });

  it("returns the same generated name for the same connection on repeated blank requests", () => {
    const names = new PresenceNames();
    const ws = fakeSocket();
    expect(names.resolve(ws, "")).toBe(names.resolve(ws, ""));
  });

  it("honors an explicit name exactly, even if it duplicates someone else's", () => {
    const names = new PresenceNames();
    const a = names.resolve(fakeSocket(), "Sam");
    const b = names.resolve(fakeSocket(), "Sam");
    expect(a).toBe("Sam");
    expect(b).toBe("Sam");
  });

  it("frees a generated name on release so it can be handed out again", () => {
    const names = new PresenceNames();
    const ws = fakeSocket();
    const generated = names.resolve(ws, "");
    names.release(ws);

    // Exhaust every other combination so the only way to get `generated`
    // back is if release() actually freed it.
    const others = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const name = names.resolve(fakeSocket(), "");
      if (name === generated) return; // reused -- test passes
      others.add(name);
    }
    expect.fail(`"${generated}" was never handed out again after release`);
  });

  it("switching from a generated name to a custom one frees the generated slot", () => {
    const names = new PresenceNames();
    const ws = fakeSocket();
    const generated = names.resolve(ws, "");
    names.resolve(ws, "Sam"); // explicit rename

    // The generated name should be available to a fresh connection now.
    let freedAgain = false;
    for (let i = 0; i < 300; i++) {
      if (names.resolve(fakeSocket(), "") === generated) {
        freedAgain = true;
        break;
      }
    }
    expect(freedAgain).toBe(true);
  });

  it("degrades to numbered guests once the generated pool is exhausted, rather than crashing", () => {
    const names = new PresenceNames();
    const generated = new Set<string>();
    for (let i = 0; i < 260; i++) generated.add(names.resolve(fakeSocket(), ""));
    expect([...generated].some((n) => /^Guest \d+$/.test(n))).toBe(true);
    // Still unique even past the pool -- no two connections share a name.
    expect(generated.size).toBe(260);
  });
});
