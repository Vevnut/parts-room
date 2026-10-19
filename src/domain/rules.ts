// The spreadsheet's rules, in one place. Screens, exports and the summary all read from
// here so they can't disagree. Source: Parts_Room_Master_List.xlsx formulas.

export const DISPOSITIONS = ["Keep", "Toss", "Donate/Sell", "Unknown"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const CONDITIONS = ["New", "Used - good", "Needs testing", "Needs repair", "Unknown"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const DEFAULT_SYSTEMS = [
  "Engine & Propulsion",
  "Electrical (AC/DC)",
  "Plumbing & Water",
  "Fuel System",
  "Steering & Controls",
  "Rigging & Deck Hardware",
  "Navigation & Electronics",
  "HVAC & Refrigeration",
  "Safety & Survival",
  "Hull & Canvas",
  "Fasteners & Hardware",
  "Tools & Consumables",
  "Other",
];

export const MANUFACTURERS = ["Mercury", "MerCruiser", "Yamaha", "Suzuki", "Volvo Penta", "Honda", "Evinrude"];

export type Status = "Not kept" | "Out of stock" | "Reorder" | "OK";
export type Placement = "n/a" | "Put away" | "Needs bin" | "Staged";

export interface Part {
  id: string;
  partId: string;
  name: string;
  systemId: string | null;
  qty: number;
  condition: Condition | null;
  disposition: Disposition | null; // null = blank, which counts as Keep
  oldLocation: string;
  binId: string | null;
  movedBack: boolean;
  manufacturer: string;
  mfrPartNumber: string;
  supplier: string;
  minQty: number | null;
  reorderQty: number | null;
  unitCost: number | null;
  retailPrice: number | null;
  lastCounted: string | null; // YYYY-MM-DD
  replaceBy: string | null; // YYYY-MM-DD
  photoLink: string;
  notes: string;
  needsDetails: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Bin {
  id: string;
  binCode: string;
  shelfZone: string;
  binSize: string;
  labelText: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface System {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const live = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

export function isKept(p: Pick<Part, "disposition">): boolean {
  return p.disposition !== "Toss" && p.disposition !== "Donate/Sell";
}

// Master List R: IF(Toss/Donate,"Not kept",IF(D<=0,"Out of stock",IF(AND(N<>"",D<=N),"Reorder","OK")))
export function statusOf(p: Part): Status {
  if (!isKept(p)) return "Not kept";
  if (p.qty <= 0) return "Out of stock";
  if (p.minQty != null && p.qty <= p.minQty) return "Reorder";
  return "OK";
}

// Master List J: IF(Toss/Donate,"n/a",IF(I="Yes","Put away",IF(H="","Needs bin","Staged")))
export function placementOf(p: Part): Placement {
  if (!isKept(p)) return "n/a";
  if (p.movedBack) return "Put away";
  if (!p.binId) return "Needs bin";
  return "Staged";
}

// Master List Q: D*P
export function totalValue(p: Part): number {
  return cents(p.qty * (p.unitCost ?? 0));
}

export interface SystemRow {
  systemId: string;
  name: string;
  keptParts: number;
  units: number;
  value: number;
  needsBin: number;
  reorder: number;
  outOfStock: number;
}

export interface Summary {
  logged: number;
  kept: number;
  notKept: number;
  unknown: number;
  needsBin: number;
  staged: number;
  putAway: number;
  pctPutAway: number;
  stockValue: number;
  bySystem: SystemRow[];
  keptWithoutSystem: number;
}

export function summarize(allParts: Part[], systems: System[]): Summary {
  const parts = live(allParts);
  const kept = parts.filter(isKept);
  const count = (pl: Placement) => parts.filter((p) => placementOf(p) === pl).length;
  const putAway = count("Put away");
  const bySystem = [...systems]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => {
      const inSys = kept.filter((p) => p.systemId === s.id);
      return {
        systemId: s.id,
        name: s.name,
        keptParts: inSys.length,
        units: inSys.reduce((t, p) => t + p.qty, 0),
        value: cents(inSys.reduce((t, p) => t + totalValue(p), 0)),
        needsBin: inSys.filter((p) => placementOf(p) === "Needs bin").length,
        reorder: inSys.filter((p) => statusOf(p) === "Reorder").length,
        outOfStock: inSys.filter((p) => statusOf(p) === "Out of stock").length,
      };
    });
  return {
    logged: parts.length,
    kept: kept.length,
    notKept: parts.length - kept.length,
    unknown: parts.filter((p) => p.disposition === "Unknown").length,
    needsBin: count("Needs bin"),
    staged: count("Staged"),
    putAway,
    pctPutAway: kept.length ? putAway / kept.length : 0,
    stockValue: cents(kept.reduce((t, p) => t + totalValue(p), 0)),
    bySystem,
    keptWithoutSystem: kept.length - bySystem.reduce((t, r) => t + r.keptParts, 0),
  };
}

// Bins E-G. Counts every part assigned to the bin, as the spreadsheet does.
export function binStats(binId: string, allParts: Part[]) {
  const inBin = live(allParts).filter((p) => p.binId === binId);
  const notPutAway = inBin.filter((p) => !p.movedBack).length;
  return {
    parts: inBin.length,
    units: inBin.reduce((t, p) => t + p.qty, 0),
    notPutAway,
    done: inBin.length > 0 && notPutAway === 0,
  };
}

export function reorderList(allParts: Part[]) {
  const rows = live(allParts)
    .filter((p) => {
      const s = statusOf(p);
      return s === "Reorder" || s === "Out of stock";
    })
    .map((part) => ({ part, status: statusOf(part), estCost: cents((part.reorderQty ?? 0) * (part.unitCost ?? 0)) }));
  return { rows, totalCost: cents(rows.reduce((t, r) => t + r.estCost, 0)) };
}

export function normalizePartId(id: string): string {
  return id.trim().toUpperCase();
}

export function nextPartId(existing: string[], prefix: string, pad: number): string {
  const pre = normalizePartId(prefix);
  const re = new RegExp(`^${pre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  let max = 0;
  for (const id of existing) {
    const m = normalizePartId(id).match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return pre + String(max + 1).padStart(pad, "0");
}

export type PartErrors = Partial<Record<keyof Part, string>>;

export function validatePart(p: Partial<Part>): PartErrors {
  const e: PartErrors = {};
  if (!p.partId?.trim()) e.partId = "Enter a Part ID.";
  if (!p.name?.trim()) e.name = "Enter a part name.";
  const nonNeg = ["qty", "minQty", "reorderQty", "unitCost", "retailPrice"] as const;
  for (const k of nonNeg) {
    const v = p[k];
    if (v != null && (!Number.isFinite(v) || v < 0)) e[k] = "Must be 0 or more.";
  }
  if (p.movedBack && !p.binId) e.movedBack = "Pick a bin before marking it put away.";
  return e;
}
