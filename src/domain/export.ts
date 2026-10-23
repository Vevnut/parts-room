// Builds the parts sheet for importing into Lightspeed DMS. Lightspeed doesn't publish one fixed
// parts layout, so the columns can be switched on/off, reordered and renamed to match the import
// template from Lightspeed; the choice is saved on the device.
import { isKept, type Bin, type Part, type System } from "./rules.js";
import { indexSystems } from "./systems.js";
import type { Cell } from "./xlsx.js";

export type ColumnKey =
  | "mfrPartNumber" | "supplier" | "manufacturer" | "name" | "qty" | "unitCost" | "retailPrice"
  | "bin" | "minQty" | "reorderQty" | "condition" | "partId" | "notes" | "oldLocation" | "lastCounted"
  | "system" | "subsystem";

export interface ExportColumn {
  key: ColumnKey;
  header: string;
  enabled: boolean;
}

export const COLUMN_HINTS: Record<ColumnKey, string> = {
  mfrPartNumber: "Mfr part #",
  supplier: "Supplier, or the manufacturer if blank",
  manufacturer: "Manufacturer",
  name: "Part name",
  qty: "Quantity",
  unitCost: "Unit cost",
  retailPrice: "Retail price",
  bin: "Bin code",
  minQty: "Min qty",
  reorderQty: "Reorder qty",
  condition: "Condition",
  partId: "This app's Part ID (MP-####)",
  notes: "Notes",
  oldLocation: "Old location",
  lastCounted: "Last counted (YYYY-MM-DD)",
  system: "Main system",
  subsystem: "Sub-system",
};

export const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "mfrPartNumber", header: "Part Number", enabled: true },
  { key: "supplier", header: "Supplier", enabled: true },
  { key: "manufacturer", header: "Manufacturer", enabled: true },
  { key: "name", header: "Description", enabled: true },
  { key: "qty", header: "Qty On Hand", enabled: true },
  { key: "unitCost", header: "Cost", enabled: true },
  { key: "retailPrice", header: "List Price", enabled: true },
  { key: "bin", header: "Bin Location", enabled: true },
  { key: "minQty", header: "Min Qty", enabled: true },
  { key: "reorderQty", header: "Reorder Qty", enabled: true },
  { key: "condition", header: "Condition", enabled: true },
  { key: "partId", header: "Internal ID", enabled: true },
  { key: "notes", header: "Notes", enabled: true },
  { key: "oldLocation", header: "Old Location", enabled: false },
  { key: "lastCounted", header: "Last Counted", enabled: false },
  { key: "system", header: "Category", enabled: false },
  { key: "subsystem", header: "Sub-category", enabled: false },
];

/** Reads saved column settings, repairing anything missing or unknown. */
export function loadColumns(saved: unknown): ExportColumn[] {
  if (!Array.isArray(saved)) return DEFAULT_EXPORT_COLUMNS.map((c) => ({ ...c }));
  const byKey = new Map(DEFAULT_EXPORT_COLUMNS.map((c) => [c.key, c]));
  const out: ExportColumn[] = [];
  for (const s of saved) {
    const def = byKey.get(s?.key);
    if (!def || out.some((c) => c.key === def.key)) continue;
    const header = typeof s.header === "string" && s.header.trim() ? s.header.trim() : def.header;
    out.push({ key: def.key, header, enabled: s.enabled === true });
  }
  for (const def of DEFAULT_EXPORT_COLUMNS) if (!out.some((c) => c.key === def.key)) out.push({ ...def, enabled: false });
  return out;
}

export interface ExportOptions {
  keptOnly: boolean; // leave out Toss and Donate/Sell
  numberedOnly: boolean; // leave out parts with no mfr part #
  skipZeroQty: boolean;
}

export interface ExportResult {
  header: string[];
  rows: Cell[][];
  skipped: { notKept: number; noNumber: number; zeroQty: number };
}

type Lookup = (id: string | null) => string;

function value(p: Part, key: ColumnKey, binCode: Lookup, mainName: Lookup, subName: Lookup): Cell {
  switch (key) {
    case "system": return mainName(p.systemId);
    case "subsystem": return subName(p.systemId);
    case "mfrPartNumber": return p.mfrPartNumber.trim();
    case "supplier": return p.supplier.trim() || p.manufacturer.trim();
    case "manufacturer": return p.manufacturer.trim();
    case "name": return p.name.trim();
    case "bin": return binCode(p.binId);
    case "condition": return p.condition ?? "";
    case "partId": return p.partId;
    case "notes": return p.notes;
    case "oldLocation": return p.oldLocation.trim();
    case "lastCounted": return p.lastCounted ?? "";
    case "qty": return p.qty;
    case "unitCost": return p.unitCost;
    case "retailPrice": return p.retailPrice;
    case "minQty": return p.minQty;
    case "reorderQty": return p.reorderQty;
  }
}

export function buildExport(parts: Part[], bins: Bin[], columns: ExportColumn[], opts: ExportOptions, systems: System[] = []): ExportResult {
  const codes = new Map(bins.filter((b) => !b.deletedAt).map((b) => [b.id, b.binCode]));
  const binCode = (id: string | null) => (id ? codes.get(id) ?? "" : "");
  const idx = indexSystems(systems);
  const mainName = (id: string | null) => idx.get(idx.mainOf(id))?.name ?? "";
  const subName = (id: string | null) => idx.get(idx.subOf(id))?.name ?? "";
  const skipped = { notKept: 0, noNumber: 0, zeroQty: 0 };
  const chosen: Part[] = [];
  for (const p of parts) {
    if (p.deletedAt) continue;
    if (opts.keptOnly && !isKept(p)) skipped.notKept++;
    else if (opts.numberedOnly && !p.mfrPartNumber.trim()) skipped.noNumber++;
    else if (opts.skipZeroQty && !(p.qty > 0)) skipped.zeroQty++;
    else chosen.push(p);
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  chosen.sort((a, b) => cmp(a.mfrPartNumber.trim(), b.mfrPartNumber.trim()) || cmp(a.partId, b.partId));
  const cols = columns.filter((c) => c.enabled);
  return {
    header: cols.map((c) => c.header),
    rows: chosen.map((p) => cols.map((c) => value(p, c.key, binCode, mainName, subName))),
    skipped,
  };
}

// Text a spreadsheet would run as a formula when it opens a CSV.
const FORMULA_START = /^[=+@\t\r]/;

export function toCsv(header: string[], rows: Cell[][]): string {
  const field = (v: Cell) => {
    if (v == null) return "";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
    const s = FORMULA_START.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}
