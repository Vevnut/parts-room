// One round trip: push local changes, then pull what changed since the client's cursors.
import { sanitize } from "./fields.js";
import { TABLES, decodeCursor, encodeCursor, type Store, type TableName, type UpsertResult, type WireRow } from "./store.js";
import type { Bin, Part, System } from "../src/domain/rules.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const MAX_PUSH = 500;
const DEFAULT_LIMIT = 500;
// Rows committed slightly out of order can carry a timestamp just before the last cursor;
// re-reading this window at the start of every sync catches them.
const OVERLAP_MS = 5000;

export type PushStatus = UpsertResult | "invalid";
export interface SyncResponse {
  results: { table: TableName; id: string; status: PushStatus; reason?: string }[];
  rows: { parts: Part[]; bins: Bin[]; systems: System[] };
  cursors: Partial<Record<TableName, string>>;
  more: boolean;
}

const isTable = (t: unknown): t is TableName => (TABLES as readonly unknown[]).includes(t);

export async function handleSync(store: Store, body: unknown): Promise<SyncResponse> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Expected a JSON object.");
  const b = body as Record<string, unknown>;
  const push = b.push ?? [];
  if (!Array.isArray(push)) throw new HttpError(400, "push must be a list.");
  if (push.length > MAX_PUSH) throw new HttpError(413, `Send at most ${MAX_PUSH} changes at a time.`);
  const cursorsIn = (b.cursors ?? {}) as Record<string, unknown>;
  if (typeof cursorsIn !== "object" || Array.isArray(cursorsIn)) throw new HttpError(400, "cursors must be an object.");
  const limit = Number.isInteger(b.limit) && (b.limit as number) > 0 && (b.limit as number) <= 1000 ? (b.limit as number) : DEFAULT_LIMIT;
  const continuing = b.continue === true;

  for (const item of push) {
    if (!item || typeof item !== "object" || !isTable((item as { table?: unknown }).table)) throw new HttpError(400, "Unknown table.");
  }

  const results: SyncResponse["results"] = [];
  for (const item of push as { table: TableName; row: unknown }[]) {
    const id = typeof (item.row as { id?: unknown })?.id === "string" ? String((item.row as { id: string }).id).slice(0, 80) : "";
    const s = sanitize(item.table, item.row);
    if ("reason" in s) {
      results.push({ table: item.table, id, status: "invalid", reason: s.reason });
      continue;
    }
    results.push({ table: item.table, id, status: await store.upsert(item.table, s.row) });
  }

  const rows: Record<TableName, WireRow[]> = { parts: [], bins: [], systems: [] };
  const cursors: SyncResponse["cursors"] = {};
  let more = false;
  for (const table of TABLES) {
    const given = decodeCursor(cursorsIn[table]);
    const from = given && !continuing ? { ts: new Date(Date.parse(given.ts) - OVERLAP_MS).toISOString(), id: "" } : given;
    const page = await store.changedSince(table, from, limit);
    rows[table] = page.rows;
    if (page.rows.length === limit) more = true;
    const last = page.last ?? given;
    if (last) cursors[table] = encodeCursor(last);
  }

  return { results, rows: rows as unknown as SyncResponse["rows"], cursors, more };
}
