// All writes go through here so the spreadsheet's rules, the uniqueness checks and the
// sync outbox apply no matter which screen saves.
import { db as defaultDb, type BinRow, type KeyValue, type PartRow, type PartsDB, type SyncedTable } from "./db";
import {
  DEFAULT_SYSTEMS,
  isKept,
  nextPartId,
  normalizePartId,
  validatePart,
  type Bin,
  type Disposition,
  type Part,
  type PartErrors,
  type PhotoMeta,
  type System,
} from "../domain/rules";

export class PartIdTakenError extends Error {
  constructor(partId: string) {
    super(`Part ID ${partId} is already used by another part.`);
    this.name = "PartIdTakenError";
  }
}
export class BinCodeTakenError extends Error {
  constructor(code: string) {
    super(`Bin ${code} already exists.`);
    this.name = "BinCodeTakenError";
  }
}
export class BinNotEmptyError extends Error {
  constructor(count: number) {
    super(`Move the ${count} part${count === 1 ? "" : "s"} out of this bin before deleting it.`);
    this.name = "BinNotEmptyError";
  }
}
export class SystemNameTakenError extends Error {
  constructor(name: string) {
    super(`There's already a system called ${name}.`);
    this.name = "SystemNameTakenError";
  }
}
export class ValidationError extends Error {
  constructor(public errors: PartErrors) {
    super(Object.values(errors)[0] ?? "Check the form.");
    this.name = "ValidationError";
  }
}

// Tests run two "devices" side by side by swapping the database for the duration of a call.
let db: PartsDB = defaultDb;
export const currentDb = () => db;
export async function withDatabase<T>(d: PartsDB, fn: () => Promise<T>): Promise<T> {
  const prev = db;
  db = d;
  try {
    return await fn();
  } finally {
    db = prev;
  }
}

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const PREFIX = "MP-";
const PAD = 4;

// Call inside a write transaction that includes db.outbox. A fresh edit clears any conflict.
async function enqueue(table: SyncedTable, ids: string[]) {
  if (ids.length) await db.outbox.bulkPut(ids.map((id) => ({ table, id, conflict: null })));
}

export async function ensureSeeded(): Promise<void> {
  await db.transaction("rw", db.systems, db.outbox, async () => {
    if ((await db.systems.count()) > 0) return;
    const rows = DEFAULT_SYSTEMS.map((name, i) => ({ id: slug(name), name, sortOrder: i + 1, active: true }));
    await db.systems.bulkAdd(rows);
    await enqueue("systems", rows.map((r) => r.id));
  });
}

// ---- systems: the list behind the System picker. Ids never change, so renaming keeps parts attached. ----

async function checkSystemName(name: string, exceptId?: string): Promise<string> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Enter a system name.");
  if (clean.length > 80) throw new Error("Keep the system name under 80 characters.");
  const clash = (await db.systems.toArray()).find((s) => s.id !== exceptId && s.name.toLowerCase() === clean.toLowerCase());
  if (clash) throw new SystemNameTakenError(clash.name);
  return clean;
}

export async function addSystem(name: string): Promise<System> {
  return db.transaction("rw", db.systems, db.outbox, async () => {
    const clean = await checkSystemName(name);
    const all = await db.systems.toArray();
    const base = slug(clean).slice(0, 56) || "system";
    let id = base;
    for (let i = 2; all.some((s) => s.id === id); i++) id = `${base}-${i}`;
    const row: System = { id, name: clean, sortOrder: Math.max(0, ...all.map((s) => s.sortOrder)) + 1, active: true };
    await db.systems.add(row);
    await enqueue("systems", [id]);
    return row;
  });
}

export async function renameSystem(id: string, name: string): Promise<void> {
  await db.transaction("rw", db.systems, db.outbox, async () => {
    const clean = await checkSystemName(name, id);
    await db.systems.update(id, { name: clean });
    await enqueue("systems", [id]);
  });
}

export async function setSystemActive(id: string, active: boolean): Promise<void> {
  await db.transaction("rw", db.systems, db.outbox, async () => {
    await db.systems.update(id, { active });
    await enqueue("systems", [id]);
  });
}

// Swap with the neighbour above (-1) or below (+1).
export async function moveSystem(id: string, direction: -1 | 1): Promise<void> {
  await db.transaction("rw", db.systems, db.outbox, async () => {
    const list = await db.systems.orderBy("sortOrder").toArray();
    const i = list.findIndex((s) => s.id === id);
    if (i < 0) return;
    // Hop over hidden systems so the move is visible in the list the user sees.
    let j = i + direction;
    while (j >= 0 && j < list.length && !list[j].active && list[i].active) j += direction;
    if (j < 0 || j >= list.length) return;
    // Renumber so equal or gappy sortOrders from older data can't stall the swap.
    const ids = list.map((s) => s.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const changed: string[] = [];
    for (let k = 0; k < ids.length; k++) {
      const s = list.find((x) => x.id === ids[k])!;
      if (s.sortOrder !== k + 1) {
        await db.systems.update(s.id, { sortOrder: k + 1 });
        changed.push(s.id);
      }
    }
    await enqueue("systems", changed);
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// Deleted parts count here too, so an ID that was ever auto-assigned is never handed out again.
export async function suggestPartId(): Promise<string> {
  const ids = (await db.parts.toArray()).map((p) => p.partId);
  return nextPartId(ids, PREFIX, PAD);
}

const blankPart = (): Omit<Part, "id" | "partId" | "name" | "createdAt" | "updatedAt"> => ({
  systemId: null,
  qty: 0,
  condition: null,
  disposition: null,
  oldLocation: "",
  binId: null,
  movedBack: false,
  manufacturer: "",
  mfrPartNumber: "",
  supplier: "",
  minQty: null,
  reorderQty: null,
  unitCost: null,
  retailPrice: null,
  lastCounted: null,
  replaceBy: null,
  photoLink: "",
  notes: "",
  needsDetails: false,
  deletedAt: null,
});

export type PartInput = Partial<Part> & Pick<Part, "partId" | "name">;

export async function savePart(input: PartInput): Promise<Part> {
  const existing = input.id ? await db.parts.get(input.id) : undefined;
  const merged: Part = {
    ...blankPart(),
    ...(existing ?? {}),
    ...input,
    id: input.id ?? uid(),
    partId: normalizePartId(input.partId),
    name: input.name.trim(),
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  } as Part;
  // Not-kept parts don't go into bins.
  if (!isKept(merged)) {
    merged.binId = null;
    merged.movedBack = false;
  }
  const errors = validatePart(merged);
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const { partKey: _old, ...clean } = merged as PartRow;
  const row: PartRow = { ...clean, partKey: merged.partId };
  try {
    await db.transaction("rw", db.parts, db.outbox, async () => {
      const clash = await db.parts.where("partKey").equals(row.partKey).first();
      if (clash && clash.id !== row.id) throw new PartIdTakenError(row.partId);
      await db.parts.put(row);
      await enqueue("parts", [row.id]);
    });
  } catch (e) {
    if (e instanceof PartIdTakenError) throw e;
    if ((e as Error)?.name === "ConstraintError") throw new PartIdTakenError(row.partId);
    throw e;
  }
  return stripPart(row);
}

export async function quickAdd(input: {
  name: string;
  systemId: string | null;
  qty: number;
  disposition: Disposition | null;
  mfrPartNumber?: string;
  manufacturer?: string;
  oldLocation?: string;
}): Promise<Part> {
  const { mfrPartNumber, manufacturer, oldLocation, ...rest } = input;
  return savePart({
    ...rest,
    mfrPartNumber: (mfrPartNumber ?? "").trim(),
    manufacturer: (manufacturer ?? "").trim(),
    oldLocation: (oldLocation ?? "").trim(),
    partId: await suggestPartId(),
    needsDetails: true,
  });
}

// Copy a part under the next Part ID, e.g. to split a lot into separate parts.
// The copy starts at qty 1, not put away, and flagged for details.
export async function duplicatePart(id: string): Promise<Part> {
  const src = await db.parts.get(id);
  if (!src || src.deletedAt) throw new Error("That part no longer exists.");
  const { id: _id, partKey: _key, createdAt: _c, updatedAt: _u, ...fields } = src;
  return savePart({ ...fields, partId: await suggestPartId(), qty: 1, movedBack: false, needsDetails: true, deletedAt: null });
}

// Soft delete so the deletion syncs; the ID is released for manual reuse.
export async function deletePart(id: string): Promise<void> {
  await db.transaction("rw", db.parts, db.outbox, async () => {
    const p = await db.parts.get(id);
    if (!p) return;
    await db.parts.put({ ...p, partKey: `deleted:${p.id}`, binId: null, movedBack: false, deletedAt: now(), updatedAt: now() });
    await enqueue("parts", [id]);
  });
}

export async function setMovedBack(id: string, movedBack: boolean): Promise<void> {
  await db.transaction("rw", db.parts, db.outbox, async () => {
    const p = await db.parts.get(id);
    if (!p) return;
    if (movedBack && !p.binId) throw new Error("Pick a bin before marking it put away.");
    await db.parts.update(id, { movedBack, updatedAt: now() });
    await enqueue("parts", [id]);
  });
}

// ---- photos ----

export async function addPhoto(partId: string, data: ArrayBuffer, mime: PhotoMeta["mime"], width: number, height: number): Promise<PhotoMeta> {
  const at = now();
  const row = { id: uid(), partId, mime, width, height, size: data.byteLength, createdAt: at, updatedAt: at, deletedAt: null, uploaded: 0 as const, data };
  await db.photos.add(row);
  const { uploaded: _u, data: _d, ...meta } = row;
  return meta;
}

// A photo that never left this device just disappears; an uploaded one is marked deleted so
// the deletion reaches the server and other devices.
export async function deletePhoto(id: string): Promise<void> {
  await db.transaction("rw", db.photos, db.outbox, async () => {
    const p = await db.photos.get(id);
    if (!p) return;
    if (!p.uploaded) {
      await db.photos.delete(id);
      return;
    }
    await db.photos.update(id, { deletedAt: now(), updatedAt: now(), data: null });
    await enqueue("photos", [id]);
  });
}

// Quick +/- from the right-click menu. Never goes below zero. Returns the new quantity.
export async function adjustQty(id: string, delta: number): Promise<number> {
  return db.transaction("rw", db.parts, db.outbox, async () => {
    const p = await db.parts.get(id);
    if (!p || p.deletedAt) return 0;
    const qty = Math.max(0, Math.round((p.qty + delta) * 100) / 100);
    await db.parts.update(id, { qty, updatedAt: now() });
    await enqueue("parts", [id]);
    return qty;
  });
}

// Returns how many parts were changed. Not-kept parts are skipped.
export async function assignBin(ids: string[], binId: string | null): Promise<number> {
  const changed: string[] = [];
  await db.transaction("rw", db.parts, db.outbox, async () => {
    for (const id of ids) {
      const p = await db.parts.get(id);
      if (!p || p.deletedAt) continue;
      if (binId && !isKept(p)) continue;
      await db.parts.update(id, { binId, movedBack: binId ? p.movedBack && p.binId === binId : false, updatedAt: now() });
      changed.push(id);
    }
    await enqueue("parts", changed);
  });
  return changed.length;
}

export async function putAwayBin(binId: string): Promise<number> {
  return db.transaction("rw", db.parts, db.outbox, async () => {
    const ids = (await db.parts.where("binId").equals(binId).filter((p) => !p.deletedAt && !p.movedBack).toArray()).map((p) => p.id);
    const at = now();
    for (const id of ids) await db.parts.update(id, { movedBack: true, updatedAt: at });
    await enqueue("parts", ids);
    return ids.length;
  });
}

export type BinInput = Partial<Bin> & Pick<Bin, "binCode">;

export async function saveBin(input: BinInput): Promise<Bin> {
  const code = input.binCode.trim().toUpperCase();
  if (!code) throw new Error("Enter a bin code.");
  const existing = input.id ? await db.bins.get(input.id) : undefined;
  const { binKey: _old, ...rest } = { ...(existing ?? {}), ...input } as Partial<BinRow>;
  const row: BinRow = {
    shelfZone: "",
    binSize: "",
    labelText: "",
    deletedAt: null,
    ...rest,
    id: input.id ?? uid(),
    binCode: code,
    binKey: code,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  try {
    await db.transaction("rw", db.bins, db.outbox, async () => {
      const clash = await db.bins.where("binKey").equals(code).first();
      if (clash && clash.id !== row.id) throw new BinCodeTakenError(code);
      await db.bins.put(row);
      await enqueue("bins", [row.id]);
    });
  } catch (e) {
    if (e instanceof BinCodeTakenError) throw e;
    if ((e as Error)?.name === "ConstraintError") throw new BinCodeTakenError(code);
    throw e;
  }
  const { binKey: _k, ...bin } = row;
  return bin;
}

export async function deleteBin(id: string): Promise<void> {
  const inBin = await db.parts.where("binId").equals(id).filter((p) => !p.deletedAt).count();
  if (inBin) throw new BinNotEmptyError(inBin);
  await db.transaction("rw", db.bins, db.outbox, async () => {
    const b = await db.bins.get(id);
    if (!b) return;
    await db.bins.put({ ...b, binKey: `deleted:${b.id}`, deletedAt: now(), updatedAt: now() });
    await enqueue("bins", [id]);
  });
}

export async function saveDraft(key: string, value: unknown): Promise<void> {
  await db.drafts.put({ key, value });
}
export async function loadDraft<T = unknown>(key: string): Promise<T | null> {
  return ((await db.drafts.get(key))?.value as T) ?? null;
}
export async function clearDraft(key: string): Promise<void> {
  await db.drafts.delete(key);
}

export interface Backup {
  app: "parts-room";
  version: 1;
  exportedAt: string;
  parts: PartRow[];
  bins: BinRow[];
  systems: System[];
  settings: KeyValue[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    app: "parts-room",
    version: 1,
    exportedAt: now(),
    parts: await db.parts.toArray(),
    bins: await db.bins.toArray(),
    systems: await db.systems.toArray(),
    settings: await db.settings.toArray(),
  };
}

// Replaces everything on this device with the backup's contents. Restored rows are stamped
// as just edited so they win over older copies on other devices when they sync.
export async function importBackup(data: unknown): Promise<{ parts: number; bins: number }> {
  const b = data as Partial<Backup>;
  if (!b || b.app !== "parts-room" || b.version !== 1 || !Array.isArray(b.parts) || !Array.isArray(b.bins) || !Array.isArray(b.systems)) {
    throw new Error("That file isn't a Parts Room backup.");
  }
  const at = now();
  await db.transaction("rw", [db.parts, db.bins, db.systems, db.settings, db.outbox], async () => {
    await Promise.all([db.parts.clear(), db.bins.clear(), db.systems.clear(), db.settings.clear(), db.outbox.clear()]);
    await db.systems.bulkAdd(b.systems!);
    await db.bins.bulkAdd(b.bins!.map((x) => ({ ...x, updatedAt: at })));
    await db.parts.bulkAdd(b.parts!.map((x) => ({ ...x, updatedAt: at })));
    if (Array.isArray(b.settings)) await db.settings.bulkAdd(b.settings);
    await enqueue("systems", b.systems!.map((x) => x.id));
    await enqueue("bins", b.bins!.map((x) => x.id));
    await enqueue("parts", b.parts!.map((x) => x.id));
  });
  return { parts: b.parts.filter((p) => !p.deletedAt).length, bins: b.bins.filter((x) => !x.deletedAt).length };
}

export function stripPart(row: PartRow): Part {
  const { partKey: _k, ...p } = row;
  return p;
}
