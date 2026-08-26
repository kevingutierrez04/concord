import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RGA, type Op } from "./rga.js";

describe("single replica", () => {
  it("inserts and deletes in order", () => {
    const doc = new RGA("site-a");
    doc.insertAt(0, "hello");
    expect(doc.getText()).toBe("hello");
    doc.deleteAt(1, 3);
    expect(doc.getText()).toBe("ho");
  });

  it("inserts in the middle", () => {
    const doc = new RGA("site-a");
    doc.insertAt(0, "ac");
    doc.insertAt(1, "b");
    expect(doc.getText()).toBe("abc");
  });
});

describe("snapshot export/import", () => {
  it("reconstructs an identical replica from exportOps", () => {
    const a = new RGA("a");
    a.insertAt(0, "hello world");
    a.deleteAt(5, 6); // -> "hello"

    const b = new RGA("b");
    for (const op of a.exportOps()) b.applyOp(op);

    expect(b.getText()).toBe(a.getText());
    expect(b.getText()).toBe("hello");
  });

  it("lets a replica bootstrapped from a snapshot still integrate later live ops", () => {
    const a = new RGA("a");
    const opsA = a.insertAt(0, "hello");

    const b = new RGA("b");
    for (const op of a.exportOps()) b.applyOp(op);

    // b inserts relative to a node it only knows about via the snapshot,
    // not via a locally-originated op
    const opsB = b.insertAt(5, "!");
    for (const op of opsB) a.applyOp(op);

    expect(a.getText()).toBe(b.getText());
    expect(a.getText()).toBe("hello!");
  });
});

describe("visibleIndexOf", () => {
  it("returns the current position of a live node and null for a deleted one", () => {
    const doc = new RGA("a");
    const [, bOp] = doc.insertAt(0, "ab");
    expect(doc.visibleIndexOf(bOp.id)).toBe(1);
    doc.deleteAt(1, 1);
    expect(doc.visibleIndexOf(bOp.id)).toBeNull();
  });
});

describe("convergence across replicas", () => {
  it("converges when two replicas make concurrent inserts at the same position", () => {
    const a = new RGA("a");
    const b = new RGA("b");

    const opsA = a.insertAt(0, "AAA");
    const opsB = b.insertAt(0, "BBB");

    for (const op of opsB) a.applyOp(op);
    for (const op of opsA) b.applyOp(op);

    expect(a.getText()).toBe(b.getText());
  });

  it("converges regardless of the order ops are applied in", () => {
    const a = new RGA("a");
    const b = new RGA("b");
    const c = new RGA("c");

    const opsA = a.insertAt(0, "foo");
    const opsB = b.insertAt(0, "bar");
    const allOps = [...opsA, ...opsB];

    for (const op of [...allOps].reverse()) c.applyOp(op);
    for (const op of opsB) a.applyOp(op);
    for (const op of opsA) b.applyOp(op);

    expect(c.getText()).toBe(a.getText());
    expect(c.getText()).toBe(b.getText());
  });

  it("handles a delete arriving before its insert", () => {
    const a = new RGA("a");
    const insertOps = a.insertAt(0, "hello");
    const deleteOps = a.deleteAt(0, 1); // delete 'h'

    const b = new RGA("b");
    for (const op of deleteOps) b.applyOp(op);
    for (const op of insertOps) b.applyOp(op);

    expect(b.getText()).toBe(a.getText());
    expect(b.getText()).toBe("ello");
  });

  it("is idempotent under duplicate delivery", () => {
    const a = new RGA("a");
    const ops = a.insertAt(0, "hi");
    const del = a.deleteAt(0, 1);

    const b = new RGA("b");
    for (const op of ops) b.applyOp(op);
    for (const op of ops) b.applyOp(op);
    for (const op of del) b.applyOp(op);
    for (const op of del) b.applyOp(op);

    expect(b.getText()).toBe(a.getText());
  });
});

// Deterministic PRNG so a failing case is reproducible from its seed.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

describe("convergence property", () => {
  it("converges for any interleaving of concurrent edits from N replicas", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            site: fc.constantFrom("a", "b", "c"),
            text: fc.string({ minLength: 1, maxLength: 5 }),
            pos: fc.nat(10),
          }),
          { minLength: 1, maxLength: 8 }
        ),
        fc.integer(),
        (edits, seed) => {
          const replicas = { a: new RGA("a"), b: new RGA("b"), c: new RGA("c") };
          const allOps: Op[] = [];

          for (const edit of edits) {
            const replica = replicas[edit.site as keyof typeof replicas];
            const clamped = Math.min(edit.pos, replica.getText().length);
            allOps.push(...replica.insertAt(clamped, edit.text));
          }

          const rng = mulberry32(seed);
          for (const name of Object.keys(replicas) as (keyof typeof replicas)[]) {
            const replica = replicas[name];
            const remoteOps = shuffle(
              allOps.filter((op) => op.id.siteId !== name),
              rng
            );
            for (const op of remoteOps) replica.applyOp(op);
          }

          const texts = Object.values(replicas).map((r) => r.getText());
          expect(new Set(texts).size).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
