// In-memory Store for tests and local experiments. Mirrors PgStore's rules.
import { uniqueKey, type Cursor, type Store, type StoredPhoto, type TableName, type UpsertResult, type WireRow } from "./store.js";

interface Entry {
  row: WireRow;
  serverTs: string;
}

export class MemoryStore implements Store {
  private tables: Record<TableName, Map<string, Entry>> = { parts: new Map(), bins: new Map(), systems: new Map(), photos: new Map() };
  private images = new Map<string, StoredPhoto>();
  private failures: { key: string; at: number }[] = [];

  constructor(private now: () => number = () => Date.now()) {}

  private stamp = () => new Date(this.now()).toISOString();

  async upsert(table: TableName, row: WireRow): Promise<UpsertResult> {
    const t = this.tables[table];
    const existing = t.get(row.id);
    if (table === "photos" && !existing) return "missing";
    if (existing && Date.parse(String(row.updatedAt)) < Date.parse(String(existing.row.updatedAt))) return "stale";
    const key = uniqueKey(table, row);
    if (key) {
      for (const [id, e] of t) if (id !== row.id && uniqueKey(table, e.row) === key) return "conflict";
    }
    // A photo's image and description never change after upload; only its deletion syncs.
    const next = table === "photos" ? { ...existing!.row, deletedAt: row.deletedAt, updatedAt: row.updatedAt } : row;
    t.set(row.id, { row: structuredClone(next), serverTs: this.stamp() });
    return "ok";
  }

  async changedSince(table: TableName, after: Cursor | null, limit: number) {
    const sorted = [...this.tables[table].values()].sort((a, b) => a.serverTs.localeCompare(b.serverTs) || a.row.id.localeCompare(b.row.id));
    const rows = sorted
      .filter((e) => !after || e.serverTs > after.ts || (e.serverTs === after.ts && e.row.id > after.id))
      .slice(0, limit);
    const lastEntry = rows[rows.length - 1];
    return {
      rows: rows.map((e) => structuredClone(e.row)),
      last: lastEntry ? { ts: lastEntry.serverTs, id: lastEntry.row.id } : null,
    };
  }

  async insertPhoto(row: WireRow, bytes: Uint8Array) {
    if (this.tables.photos.has(row.id)) return;
    this.tables.photos.set(row.id, { row: structuredClone(row), serverTs: this.stamp() });
    this.images.set(row.id, { mime: String(row.mime), bytes: bytes.slice() });
  }

  async getPhoto(id: string) {
    const e = this.tables.photos.get(id);
    if (!e || e.row.deletedAt) return null;
    return this.images.get(id) ?? null;
  }

  async countFailedLogins(key: string, sinceMs: number) {
    return this.failures.filter((f) => f.key === key && f.at >= sinceMs).length;
  }
  async recordFailedLogin(key: string, atMs: number) {
    this.failures.push({ key, at: atMs });
  }
  async clearFailedLogins(key: string) {
    this.failures = this.failures.filter((f) => f.key !== key);
  }
}
