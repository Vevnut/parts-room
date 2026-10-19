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

export function filterParts(parts: Part[], f: PartFilters, binCode: (id: string) => string = () => ""): Part[] {
  const q = norm(f.q);
  return parts.filter((p) => {
    if (q) {
      const hay = [p.partId, p.name, p.mfrPartNumber, p.manufacturer, p.supplier, p.notes, p.oldLocation, p.binId ? binCode(p.binId) : ""].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.system && (f.system === "none" ? p.systemId : p.systemId !== f.system)) return false;
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
