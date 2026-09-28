import { describe, expect, it } from "vitest";
import { colorFor, randomName } from "./identity";

describe("colorFor", () => {
  it("is deterministic and always a #rrggbb color the server will accept", () => {
    for (const id of ["a", "b", crypto.randomUUID(), ""]) {
      expect(colorFor(id)).toBe(colorFor(id));
      expect(colorFor(id)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("spreads different ids across the palette", () => {
    const colors = new Set(Array.from({ length: 50 }, (_, i) => colorFor(`user-${i}`)));
    expect(colors.size).toBeGreaterThan(3);
  });
});

describe("randomName", () => {
  it("produces an adjective-animal pair", () => {
    expect(randomName(() => 0)).toBe("Swift Otter");
    expect(randomName()).toMatch(/^\w+ \w+$/);
  });
});
