// What the sync and login handlers need from a database. MemoryStore backs the tests;
// PgStore backs production (Neon Postgres). Both must behave the same.

export const TABLES = ["parts", "bins", "systems"] as const;
export type TableName = (typeof TABLES)[number];
export type WireRow = Record<string, unknown> & { id: string };
export type UpsertResult = "ok" | "stale" | "conflict";

// Rows are ordered by (serverUpdatedAt, id). A cursor is the last row a client has seen.
export interface Cursor {
  ts: string; // ISO timestamp, millisecond precision
  id: string;
}
export const encodeCursor = (c: Cursor) => `${c.ts}|${c.id}`;
export function decodeCursor(s: unknown): Cursor | null {
  if (typeof s !== "string" || !s.includes("|")) return null;
  const [ts, id] = s.split("|", 2);
  return Number.isNaN(Date.parse(ts)) ? null : { ts: new Date(ts).toISOString(), id };
}

export interface Store {
  /** Insert or update by id. Older updatedAt than stored -> "stale"; unique key clash -> "conflict". */
  upsert(table: TableName, row: WireRow): Promise<UpsertResult>;
  /** Rows strictly after the cursor, in (serverUpdatedAt, id) order. */
  changedSince(table: TableName, after: Cursor | null, limit: number): Promise<{ rows: WireRow[]; last: Cursor | null }>;
  countFailedLogins(key: string, sinceMs: number): Promise<number>;
  recordFailedLogin(key: string, atMs: number): Promise<void>;
  clearFailedLogins(key: string): Promise<void>;
}

// Unique business keys, ignoring deleted rows.
export function uniqueKey(table: TableName, row: WireRow): string | null {
  if (row.deletedAt) return null;
  if (table === "parts") return String(row.partId ?? "").trim().toUpperCase();
  if (table === "bins") return String(row.binCode ?? "").trim().toUpperCase();
  return null;
}
