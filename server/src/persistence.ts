import Database from "better-sqlite3";
import type { Op } from "../../crdt/src/rga.js";

export interface OpLog {
  load(): Op[];
  append(ops: Op[]): void;
  close(): void;
}

export class SqliteOpLog implements OpLog {
  private readonly db: Database.Database;
  private readonly insertOp: Database.Statement<[string]>;
  private readonly appendMany: (ops: Op[]) => void;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS ops (seq INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT NOT NULL)"
    );
    this.insertOp = this.db.prepare("INSERT INTO ops (op) VALUES (?)");
    this.appendMany = this.db.transaction((ops: Op[]) => {
      for (const op of ops) this.insertOp.run(JSON.stringify(op));
    });
  }

  load(): Op[] {
    const rows = this.db.prepare("SELECT op FROM ops ORDER BY seq").all() as { op: string }[];
    return rows.map((row) => JSON.parse(row.op) as Op);
  }

  // One transaction per batch, so a batch is either fully durable or not
  // present at all after a crash.
  append(ops: Op[]): void {
    if (ops.length > 0) this.appendMany(ops);
  }

  close(): void {
    this.db.close();
  }
}
