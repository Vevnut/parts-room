// Sends this device's outbox to the server and merges back what other devices changed.
// Rule of thumb: the newest edit (by updatedAt) wins; an unsent local edit is never overwritten
// by an older copy; a refused Part ID stays on this device, flagged, until it's changed.
import type { BinRow, OutboxEntry, PartRow, PartsDB, SyncedTable } from "../db/db";
import type { SyncResponse } from "../../server/syncHandler";

export interface SyncRequest {
  push: { table: SyncedTable; row: Record<string, unknown> }[];
  cursors: Partial<Record<SyncedTable, string>>;
  continue?: boolean;
  limit?: number;
}
export interface Remote {
  sync(body: SyncRequest): Promise<SyncResponse>;
}

const TABLES: SyncedTable[] = ["systems", "bins", "parts"];
const BATCH = 400;

const strip = (row: Record<string, unknown>) => {
  const { partKey: _p, binKey: _b, ...rest } = row;
  return rest;
};
const newer = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && Date.parse(a) > Date.parse(b);
const entryKey = (t: SyncedTable, id: string) => `${t}:${id}`;

function conflictMessage(table: SyncedTable, row: Record<string, unknown> | undefined, status: string, reason?: string) {
  if (status === "invalid") return `The server refused this ${table === "parts" ? "part" : "entry"}: ${reason ?? "invalid data"}.`;
  if (table === "parts") return `Part ID ${row?.partId ?? ""} is already used by another part. Give this part a new ID.`;
  if (table === "bins") return `Bin ${row?.binCode ?? ""} already exists. Give this bin a different ID.`;
  return "The server refused this change.";
}

export interface SyncSummary {
  pushed: number;
  pulled: number;
  conflicts: number;
}

export async function syncOnce(remote: Remote, database: PartsDB, opts: { limit?: number } = {}): Promise<SyncSummary> {
  const summary: SyncSummary = { pushed: 0, pulled: 0, conflicts: 0 };
  const sent = new Set<string>();
  let continuing = false;

  for (let round = 0; round < 100; round++) {
    // Next batch of unsent, unflagged changes, with a snapshot of exactly what was sent.
    const entries = (await database.outbox.filter((e) => !e.conflict && !sent.has(entryKey(e.table, e.id))).limit(BATCH).toArray()) as OutboxEntry[];
    const snapshot = new Map<string, string>();
    const push: SyncRequest["push"] = [];
    for (const e of entries) {
      sent.add(entryKey(e.table, e.id));
      const row = (await database.table(e.table).get(e.id)) as Record<string, unknown> | undefined;
      if (!row) {
        await database.outbox.delete([e.table, e.id]);
        continue;
      }
      const clean = strip(row);
      snapshot.set(entryKey(e.table, e.id), JSON.stringify(clean));
      push.push({ table: e.table, row: clean });
    }

    const cursors = ((await database.syncState.get("cursors"))?.value ?? {}) as SyncRequest["cursors"];
    const res = await remote.sync({ push, cursors, continue: continuing, ...(opts.limit ? { limit: opts.limit } : {}) });
    summary.pushed += push.length;

    await database.transaction("rw", [database.parts, database.bins, database.systems, database.outbox, database.syncState], async () => {
      for (const r of res.results) {
        const key = entryKey(r.table, r.id);
        const entry = await database.outbox.get([r.table, r.id]);
        if (!entry) continue;
        const current = (await database.table(r.table).get(r.id)) as Record<string, unknown> | undefined;
        const unchanged = current && JSON.stringify(strip(current)) === snapshot.get(key);
        if (r.status === "ok" || r.status === "stale") {
          // Only clear it if nobody edited the row while the request was in flight.
          if (unchanged || !current) await database.outbox.delete([r.table, r.id]);
        } else if (unchanged) {
          await database.outbox.put({ ...entry, conflict: conflictMessage(r.table, current, r.status, r.reason) });
          summary.conflicts++;
        }
      }
      for (const table of TABLES) {
        for (const row of res.rows[table] as unknown as Record<string, unknown>[]) {
          if (await merge(database, table, row)) summary.pulled++;
        }
      }
      await database.syncState.put({ key: "cursors", value: { ...cursors, ...res.cursors } });
      await database.syncState.put({ key: "lastSyncAt", value: new Date().toISOString() });
    });

    const morePush = (await database.outbox.filter((e) => !e.conflict && !sent.has(entryKey(e.table, e.id))).count()) > 0;
    if (!res.more && !morePush) break;
    continuing = res.more;
  }
  return summary;
}

// Apply one row from the server. Returns true if local data changed.
async function merge(database: PartsDB, table: SyncedTable, row: Record<string, unknown>): Promise<boolean> {
  const id = String(row.id);
  const local = (await database.table(table).get(id)) as Record<string, unknown> | undefined;
  const pending = await database.outbox.get([table, id]);
  if (pending && local) {
    // An unsent local edit wins unless the server's copy is newer. Systems have no timestamp: local wins.
    if (table === "systems" || !newer(row.updatedAt, local.updatedAt)) return false;
  }

  if (table === "parts") {
    const key = row.deletedAt ? `deleted:${id}` : String(row.partId).trim().toUpperCase();
    await moveAsideClash(database, "parts", "partKey", key, id);
    await database.parts.put({ ...(row as unknown as PartRow), partKey: key });
  } else if (table === "bins") {
    const key = row.deletedAt ? `deleted:${id}` : String(row.binCode).trim().toUpperCase();
    await moveAsideClash(database, "bins", "binKey", key, id);
    await database.bins.put({ ...(row as unknown as BinRow), binKey: key });
  } else {
    await database.systems.put(row as never);
  }
  if (pending) await database.outbox.delete([table, id]);
  return true;
}

// A local row holding the same Part ID / bin code as an incoming server row is this device's
// unsynced duplicate: keep it, but park its key so both can exist until it's renamed.
async function moveAsideClash(database: PartsDB, table: "parts" | "bins", index: "partKey" | "binKey", key: string, incomingId: string) {
  const t = database.table(table);
  const clash = (await t.where(index).equals(key).first()) as Record<string, unknown> | undefined;
  if (!clash || clash.id === incomingId) return;
  await t.put({ ...clash, [index]: `conflict:${clash.id}` });
}

export interface SyncStatus {
  pending: number;
  conflicts: { table: SyncedTable; id: string; reason: string }[];
  lastSyncAt: string | null;
}

export async function syncStatus(database: PartsDB): Promise<SyncStatus> {
  const all = await database.outbox.toArray();
  return {
    // Parts and bins only: the built-in systems list syncs too, but isn't something the user changed.
    pending: all.filter((e) => !e.conflict && e.table !== "systems").length,
    conflicts: all.filter((e) => e.conflict).map((e) => ({ table: e.table, id: e.id, reason: e.conflict! })),
    lastSyncAt: ((await database.syncState.get("lastSyncAt"))?.value as string | undefined) ?? null,
  };
}
