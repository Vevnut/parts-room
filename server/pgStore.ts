// Store backed by Neon Postgres (db/schema.sql). Same rules as MemoryStore: last write wins by
// updatedAt, unique live Part IDs / bin codes, rows ordered by (server_updated_at, id).
import { neon } from "@neondatabase/serverless";
import { FIELDS, snake } from "./fields.js";
import type { Cursor, Store, TableName, UpsertResult, WireRow } from "./store.js";

const ISO_MS = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const TABLE_SQL: Record<TableName, string> = { parts: "parts", bins: "bins", systems: "systems", photos: "photos" };

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
    if (table === "photos") {
      // Photos are created by insertPhoto; through sync they can only be deleted.
      const done = await this.q(
        `update photos set deleted_at = $2::timestamptz, updated_at = $3::timestamptz, server_updated_at = date_trunc('milliseconds', clock_timestamp()) ` +
          `where id = $1::uuid and updated_at <= $3::timestamptz returning id`,
        [row.id, row.deletedAt ?? null, row.updatedAt],
      );
      if (done.length) return "ok";
      const exists = await this.q(`select 1 from photos where id = $1::uuid`, [row.id]);
      return exists.length ? "stale" : "missing";
    }
    const names = Object.keys(FIELDS[table]);
    const cols = names.map(snake);
    const values = names.map((n) => row[n] ?? null);
    const placeholders = names.map((_, i) => `$${i + 1}`);
    // Apps from before sub-systems / container spots send no parent / spot; keep the stored one.
    const keepWhenMissing = (table === "systems" && ["parent_id"]) || (table === "parts" && ["staging_spot"]) || [];
    const updates = cols
      .filter((c) => c !== "id")
      .map((c) => (keepWhenMissing.includes(c) ? `${c} = coalesce(excluded.${c}, ${TABLE_SQL[table]}.${c})` : `${c} = excluded.${c}`));
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

  // Image bytes go in and out as base64 text so the HTTP driver never has to guess at binary types.
  async insertPhoto(row: WireRow, bytes: Uint8Array) {
    const names = Object.keys(FIELDS.photos);
    const cols = names.map(snake);
    const values = names.map((n) => row[n] ?? null);
    const placeholders = names.map((_, i) => `$${i + 1}`);
    await this.q(
      `insert into photos (${cols.join(", ")}, bytes) values (${placeholders.join(", ")}, decode($${names.length + 1}, 'base64')) on conflict (id) do nothing`,
      [...values, Buffer.from(bytes).toString("base64")],
    );
  }

  async getPhoto(id: string) {
    const rows = await this.q(`select mime, encode(bytes, 'base64') as b64 from photos where id = $1::uuid and deleted_at is null`, [id]);
    if (!rows.length) return null;
    return { mime: String(rows[0].mime), bytes: new Uint8Array(Buffer.from(String(rows[0].b64).replace(/\s+/g, ""), "base64")) };
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
