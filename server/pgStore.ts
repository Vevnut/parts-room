// Store backed by Neon Postgres (db/schema.sql). Same rules as MemoryStore: last write wins by
// updatedAt, unique live Part IDs / bin codes, rows ordered by (server_updated_at, id).
import { neon } from "@neondatabase/serverless";
import { FIELDS, snake } from "./fields";
import type { Cursor, Store, TableName, UpsertResult, WireRow } from "./store";

const ISO_MS = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const TABLE_SQL: Record<TableName, string> = { parts: "parts", bins: "bins", systems: "systems" };

// How each field is read back so the client gets exactly the JSON types it sent.
function selectExpr(name: string, kind: string): string {
  const col = snake(name);
  switch (kind) {
    case "num":
      return `${col}::float8 as "${name}"`;
    case "date":
      return `${col}::text as "${name}"`;
    case "ts":
      return `to_char(${col} at time zone 'UTC', ${ISO_MS}) as "${name}"`;
    case "uuid":
      return `${col}::text as "${name}"`;
    default:
      return `${col} as "${name}"`;
  }
}

export class PgStore implements Store {
  private sql: ReturnType<typeof neon>;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  private q(text: string, params: unknown[] = []) {
    return this.sql(text, params) as unknown as Promise<Record<string, unknown>[]>;
  }

  async upsert(table: TableName, row: WireRow): Promise<UpsertResult> {
    const names = Object.keys(FIELDS[table]);
    const cols = names.map(snake);
    const values = names.map((n) => row[n] ?? null);
    const placeholders = names.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    const guard = table === "systems" ? "" : ` where ${TABLE_SQL[table]}.updated_at <= excluded.updated_at`;
    const text =
      `insert into ${TABLE_SQL[table]} (${cols.join(", ")}) values (${placeholders.join(", ")}) ` +
      `on conflict (id) do update set ${updates.join(", ")}, server_updated_at = date_trunc('milliseconds', clock_timestamp())${guard} ` +
      `returning id`;
    try {
      const rows = await this.q(text, values);
      return rows.length ? "ok" : "stale";
    } catch (e) {
      if ((e as { code?: string }).code === "23505") return "conflict";
      throw e;
    }
  }

  async changedSince(table: TableName, after: Cursor | null, limit: number) {
    const fields = Object.entries(FIELDS[table]).map(([n, s]) => selectExpr(n, s.kind));
    const text =
      `select ${fields.join(", ")}, to_char(server_updated_at at time zone 'UTC', ${ISO_MS}) as "__ts" ` +
      `from ${TABLE_SQL[table]} ` +
      `where $1::timestamptz is null or (server_updated_at, id::text) > ($1::timestamptz, $2::text) ` +
      `order by server_updated_at, id::text limit $3`;
    const rows = await this.q(text, [after?.ts ?? null, after?.id ?? "", limit]);
    const last = rows[rows.length - 1];
    return {
      rows: rows.map(({ __ts: _ts, ...r }) => r as WireRow),
      last: last ? { ts: String(last.__ts), id: String(last.id) } : null,
    };
  }

  async countFailedLogins(key: string, sinceMs: number) {
    const rows = await this.q(`select count(*)::int as n from login_failures where key = $1 and at >= to_timestamp($2::float8 / 1000)`, [key, sinceMs]);
    return Number(rows[0]?.n ?? 0);
  }

  async recordFailedLogin(key: string, atMs: number) {
    await this.q(`insert into login_failures (key, at) values ($1, to_timestamp($2::float8 / 1000))`, [key, atMs]);
    await this.q(`delete from login_failures where at < now() - interval '2 days'`);
  }

  async clearFailedLogins(key: string) {
    await this.q(`delete from login_failures where key = $1`, [key]);
  }
}
