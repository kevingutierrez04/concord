import { describe, expect, it } from "vitest";
import { initialsFor } from "./identity";

describe("initialsFor", () => {
  it("takes the first letter of the first and last word", () => {
    expect(initialsFor("Swift Otter")).toBe("SO");
    expect(initialsFor("Ann")).toBe("A");
    expect(initialsFor("Ann Marie Lee")).toBe("AL");
  });

  it("falls back to a placeholder for empty input", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
  });
});
