// Parts list search and filters, kept apart from the screen so they can be tested.
import { isKept, placementOf, statusOf, type Part } from "./rules.js";

export interface PartFilters {
  q?: string;
  system?: string; // system id, or "none"
  bin?: string; // bin id, or "none"
  status?: string;
  placement?: string;
  disposition?: string; // a disposition, or "blank"
  details?: boolean; // only parts still needing details
  mfr?: string; // manufacturer (any case), or "none"
  loc?: string; // old location (any case), or "none"
  noPrice?: boolean; // kept or for-sale parts with no retail price yet
}

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const matchText = (wanted: string | undefined, actual: string) => {
  if (!wanted) return true;
  if (wanted === "none") return !norm(actual);
  return norm(actual) === norm(wanted);
};

// parentOf maps a sub-system to its main system, so filtering by a main system includes its sub-systems.
export function filterParts(
  parts: Part[],
  f: PartFilters,
  binCode: (id: string) => string = () => "",
  parentOf: (systemId: string) => string | null = () => null,
): Part[] {
  const q = norm(f.q);
  return parts.filter((p) => {
    if (q) {
      const hay = [p.partId, p.name, p.mfrPartNumber, p.manufacturer, p.supplier, p.notes, p.oldLocation, p.binId ? binCode(p.binId) : ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.system && (f.system === "none" ? p.systemId : !p.systemId || (p.systemId !== f.system && parentOf(p.systemId) !== f.system))) return false;
    if (f.bin && (f.bin === "none" ? p.binId : p.binId !== f.bin)) return false;
    if (f.status && statusOf(p) !== f.status) return false;
    if (f.placement && placementOf(p) !== f.placement) return false;
    if (f.disposition && (f.disposition === "blank" ? p.disposition : p.disposition !== f.disposition)) return false;
    if (f.details && !p.needsDetails) return false;
    if (!matchText(f.mfr, p.manufacturer)) return false;
    if (!matchText(f.loc, p.oldLocation)) return false;
    if (f.noPrice && (p.retailPrice != null || (!isKept(p) && p.disposition !== "Donate/Sell"))) return false;
    return true;
  });
}

export interface TextOption {
  value: string; // normalized, used in the filter
  label: string; // the spelling most parts use
  count: number;
}
export type ManufacturerOption = TextOption;

// One entry per value actually entered on a part, however it was capitalized, A to Z.
export function distinctOptions(parts: Part[], field: "manufacturer" | "oldLocation"): TextOption[] {
  const groups = new Map<string, Map<string, number>>();
  for (const p of parts) {
    const key = norm(p[field]);
    if (!key) continue;
    const spelling = p[field].trim().replace(/\s+/g, " ");
    const g = groups.get(key) ?? new Map<string, number>();
    g.set(spelling, (g.get(spelling) ?? 0) + 1);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([value, spellings]) => {
      // Most-used spelling wins; on a tie, the one that starts with a capital.
      const capital = (s: string) => (s[0] && s[0] !== s[0].toLowerCase() ? 0 : 1);
      const [label] = [...spellings.entries()].sort((a, b) => b[1] - a[1] || capital(a[0]) - capital(b[0]) || a[0].localeCompare(b[0]))[0];
      return { value, label, count: [...spellings.values()].reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export const manufacturerOptions = (parts: Part[]) => distinctOptions(parts, "manufacturer");

export interface OldBin {
  value: string; // matches the Parts screen's "loc" filter
  label: string;
  parts: number;
  units: number;
  retail: number; // qty × retail price, priced parts only
  unpriced: number;
}

/** Parts grouped by where they were in the old room ("old bins"), in label order. */
export function oldBins(parts: Part[]): OldBin[] {
  return distinctOptions(parts, "oldLocation").map((o) => {
    const inBin = parts.filter((p) => norm(p.oldLocation) === o.value);
    return {
      value: o.value,
      label: o.label,
      parts: inBin.length,
      units: inBin.reduce((s, p) => s + p.qty, 0),
      retail: inBin.reduce((s, p) => s + (p.retailPrice == null ? 0 : p.qty * p.retailPrice), 0),
      unpriced: inBin.filter((p) => p.retailPrice == null).length,
    };
  });
}

// Part numbers match ignoring case, spaces, dashes and dots ("47-8M0137219" = "478m0137219").
const partNumberKey = (s: string) => s.toUpperCase().replace(/[\s.-]+/g, "");

/** Live parts already logged under this mfr part number, other than exceptId. */
export function samePartNumber(parts: Part[], mfrPartNumber: string, exceptId?: string): Part[] {
  const key = partNumberKey(mfrPartNumber);
  if (!key) return [];
  return parts.filter((p) => !p.deletedAt && p.id !== exceptId && partNumberKey(p.mfrPartNumber) === key);
}
