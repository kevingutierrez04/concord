export type SiteId = string;

export interface NodeId {
  counter: number;
  siteId: SiteId;
}

interface RGANode {
  id: NodeId;
  value: string;
  leftOrigin: NodeId | null;
  deleted: boolean;
}

export interface InsertOp {
  type: "insert";
  id: NodeId;
  value: string;
  leftOrigin: NodeId | null;
}

export interface DeleteOp {
  type: "delete";
  id: NodeId;
}

export type Op = InsertOp | DeleteOp;

function idKey(id: NodeId): string {
  return `${id.counter}:${id.siteId}`;
}

// Total order over ids, used only to break ties between two nodes inserted
// at the same position. Unrelated to real-world insertion time.
function compareId(a: NodeId, b: NodeId): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0;
}

export class RGA {
  private nodes: RGANode[] = [];
  private nodeIndex = new Map<string, number>();
  private counter = 0;
  private pendingInserts = new Map<string, InsertOp[]>();
  private pendingDeletes = new Map<string, DeleteOp[]>();

  constructor(private readonly siteId: SiteId) {}

  getSiteId(): SiteId {
    return this.siteId;
  }

  getText(): string {
    let out = "";
    for (const node of this.nodes) {
      if (!node.deleted) out += node.value;
    }
    return out;
  }

  // Inserts `text` at plain-text position `index`, one RGA node per
  // character. Applies each op through the same path a remote op would
  // take, then returns the ops so a caller can broadcast them.
  insertAt(index: number, text: string): InsertOp[] {
    const ops: InsertOp[] = [];
    let afterId = this.anchorAt(index);
    for (const ch of text) {
      const op: InsertOp = {
        type: "insert",
        id: { counter: ++this.counter, siteId: this.siteId },
        value: ch,
        leftOrigin: afterId,
      };
      this.applyOp(op);
      ops.push(op);
      afterId = op.id;
    }
    return ops;
  }

  // Deletes `length` visible characters starting at plain-text position
  // `index`.
  deleteAt(index: number, length: number): DeleteOp[] {
    const targetIds = this.visibleIdsInRange(index, length);
    const ops: DeleteOp[] = [];
    for (const id of targetIds) {
      const op: DeleteOp = { type: "delete", id };
      this.applyOp(op);
      ops.push(op);
    }
    return ops;
  }

  // Entry point for both locally-generated and remotely-received ops.
  // Idempotent, and safe to call with ops whose dependencies (the node
  // an insert points at, or the node a delete targets) haven't arrived
  // yet -- those are buffered until the dependency is applied.
  applyOp(op: Op): void {
    if (op.type === "insert") {
      this.applyInsert(op);
    } else {
      this.applyDelete(op);
    }
  }

  private applyInsert(op: InsertOp): void {
    if (this.nodeIndex.has(idKey(op.id))) return;

    if (op.leftOrigin !== null && !this.nodeIndex.has(idKey(op.leftOrigin))) {
      this.buffer(this.pendingInserts, op.leftOrigin, op);
      return;
    }

    // Keep the local counter ahead of any counter observed from another
    // site so future local ids never collide with ids from elsewhere.
    this.counter = Math.max(this.counter, op.id.counter);

    const node: RGANode = {
      id: op.id,
      value: op.value,
      leftOrigin: op.leftOrigin,
      deleted: false,
    };
    this.integrateInsert(node);
    this.retryPending(op.id);
  }

  private applyDelete(op: DeleteOp): void {
    const idx = this.nodeIndex.get(idKey(op.id));
    if (idx === undefined) {
      this.buffer(this.pendingDeletes, op.id, op);
      return;
    }
    this.nodes[idx].deleted = true;
  }

  // Places `node` in total order relative to nodes already present.
  // Starts right after leftOrigin, then walks right past any node that
  // is "competing" for that same slot with higher priority: a direct
  // sibling (same leftOrigin) with a greater id, or a node descending
  // from something further right than our own origin.
  private integrateInsert(node: RGANode): void {
    const leftIdx =
      node.leftOrigin === null ? -1 : this.nodeIndex.get(idKey(node.leftOrigin))!;
    let i = leftIdx + 1;

    while (i < this.nodes.length) {
      const other = this.nodes[i];
      const otherOriginIdx =
        other.leftOrigin === null ? -1 : this.nodeIndex.get(idKey(other.leftOrigin))!;

      if (otherOriginIdx < leftIdx) break;
      if (otherOriginIdx === leftIdx) {
        if (compareId(other.id, node.id) > 0) {
          i++;
          continue;
        }
        break;
      }
      i++;
    }

    this.nodes.splice(i, 0, node);
    this.reindexFrom(i);
  }

  private reindexFrom(from: number): void {
    for (let i = from; i < this.nodes.length; i++) {
      this.nodeIndex.set(idKey(this.nodes[i].id), i);
    }
  }

  private buffer<T extends Op>(map: Map<string, T[]>, missingId: NodeId, op: T): void {
    const key = idKey(missingId);
    const list = map.get(key) ?? [];
    list.push(op);
    map.set(key, list);
  }

  private retryPending(resolvedId: NodeId): void {
    const key = idKey(resolvedId);

    const inserts = this.pendingInserts.get(key);
    if (inserts) {
      this.pendingInserts.delete(key);
      for (const op of inserts) this.applyInsert(op);
    }

    const deletes = this.pendingDeletes.get(key);
    if (deletes) {
      this.pendingDeletes.delete(key);
      for (const op of deletes) this.applyDelete(op);
    }
  }

  // Id of the visible node immediately before plain-text position `index`,
  // or null if `index` is 0 (the very start). Unlike a raw index, this stays
  // pointing at the same spot in the document as concurrent edits land.
  anchorAt(index: number): NodeId | null {
    if (index <= 0) return null;
    let seen = 0;
    for (const node of this.nodes) {
      if (node.deleted) continue;
      seen++;
      if (seen === index) return node.id;
    }
    return null;
  }

  // The current visible-text index of `id`, or null if it doesn't exist or
  // is deleted.
  visibleIndexOf(id: NodeId): number | null {
    let seen = 0;
    for (const node of this.nodes) {
      if (idKey(node.id) === idKey(id)) {
        return node.deleted ? null : seen;
      }
      if (!node.deleted) seen++;
    }
    return null;
  }

  // Inverse of anchorAt: the plain-text caret position just after `anchor`
  // (0 for null). A tombstoned anchor resolves to where it used to be.
  // Returns null if the anchor's insert hasn't been received yet.
  indexOfAnchor(anchor: NodeId | null): number | null {
    if (anchor === null) return 0;
    let seen = 0;
    for (const node of this.nodes) {
      if (!node.deleted) seen++;
      if (idKey(node.id) === idKey(anchor)) return seen;
    }
    return null;
  }

  // All ops needed to reconstruct this replica's exact current state,
  // including tombstones and original ids: every node as an InsertOp in
  // current array order (always a valid causal order, since a node is
  // always placed after its leftOrigin's existing position), followed by
  // a DeleteOp for each tombstoned node.
  exportOps(): Op[] {
    const ops: Op[] = [];
    for (const node of this.nodes) {
      ops.push({ type: "insert", id: node.id, value: node.value, leftOrigin: node.leftOrigin });
    }
    for (const node of this.nodes) {
      if (node.deleted) ops.push({ type: "delete", id: node.id });
    }
    return ops;
  }

  private visibleIdsInRange(index: number, length: number): NodeId[] {
    const ids: NodeId[] = [];
    let seen = 0;
    for (const node of this.nodes) {
      if (node.deleted) continue;
      if (seen >= index && seen < index + length) ids.push(node.id);
      seen++;
      if (seen >= index + length) break;
    }
    return ids;
  }
}
