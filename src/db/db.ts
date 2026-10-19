// The device's own database. Every screen reads and writes here, so nothing waits on the
// network; the outbox lists rows changed here that the server hasn't confirmed yet.
import Dexie, { type EntityTable } from "dexie";
import type { Bin, Part, PhotoMeta, System } from "../domain/rules";

// partKey / binKey are the normalized IDs that carry the unique index.
export type PartRow = Part & { partKey: string };
export type BinRow = Bin & { binKey: string };
export interface KeyValue {
  key: string;
  value: unknown;
}
export type SyncedTable = "parts" | "bins" | "systems" | "photos";
// A photo on this device. `data` is the image (null until downloaded on devices that didn't take it);
// `uploaded` is 0 until the image has reached the server.
export type PhotoRow = PhotoMeta & { uploaded: 0 | 1; data: ArrayBuffer | null; uploadError?: string };
export interface OutboxEntry {
  table: SyncedTable;
  id: string;
  conflict: string | null; // set when the server refused the row; cleared by the next local edit
}

export class PartsDB extends Dexie {
  parts!: EntityTable<PartRow, "id">;
  bins!: EntityTable<BinRow, "id">;
  systems!: EntityTable<System, "id">;
  settings!: EntityTable<KeyValue, "key">;
  drafts!: EntityTable<KeyValue, "key">;
  outbox!: Dexie.Table<OutboxEntry, [SyncedTable, string]>;
  syncState!: EntityTable<KeyValue, "key">;
  photos!: EntityTable<PhotoRow, "id">;

  constructor(name = "parts-room") {
    super(name);
    this.version(1).stores({
      parts: "id, &partKey, binId, systemId, updatedAt, deletedAt",
      bins: "id, &binKey, deletedAt",
      systems: "id, sortOrder",
      settings: "key",
      drafts: "key",
    });
    this.version(2)
      .stores({ outbox: "[table+id], table", syncState: "key" })
      .upgrade(async (tx) => {
        // Everything logged before sync existed still needs to reach the server.
        for (const table of ["parts", "bins", "systems"] as const) {
          const ids = (await tx.table(table).toCollection().primaryKeys()) as string[];
          await tx.table("outbox").bulkPut(ids.map((id) => ({ table, id, conflict: null })));
        }
      });
    this.version(3).stores({ photos: "id, partId, uploaded" });
  }
}

export const db = new PartsDB();
