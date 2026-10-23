// The system index: main systems, each with optional sub-systems (one level deep).
// A part's systemId points at either; a part in a sub-system also counts as in its main system.
import type { System } from "./rules.js";

export interface SystemOption {
  value: string;
  label: string; // sub-systems are indented with "— "
  active: boolean;
  sub: boolean;
}

export interface SystemIndex {
  mains: System[];
  subs: (mainId: string) => System[];
  get: (id: string | null) => System | undefined;
  mainOf: (id: string | null) => string | null;
  subOf: (id: string | null) => string | null;
  label: (id: string | null) => string;
  within: (partSystemId: string | null, filterId: string) => boolean;
  options: () => SystemOption[];
  /** "M01-01-47-8M0137219": main system code, sub-system code, mfr part number. */
  code: (systemId: string | null, mfrPartNumber: string) => string;
}

const byOrder = (a: System, b: System) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

// The code in brackets at the end of a system name ("MERCURY (M01)" → "M01"), else the whole name.
const shortCode = (s: System | undefined) => (s ? (/\(([^()]+)\)\s*$/.exec(s.name)?.[1] ?? s.name).trim() : "");

export function indexSystems(systems: System[]): SystemIndex {
  const byId = new Map(systems.map((s) => [s.id, s]));
  const mains = systems.filter((s) => !s.parentId).sort(byOrder);
  const children = new Map<string, System[]>();
  for (const s of systems) if (s.parentId) children.set(s.parentId, [...(children.get(s.parentId) ?? []), s]);
  for (const list of children.values()) list.sort(byOrder);

  const get = (id: string | null) => (id ? byId.get(id) : undefined);
  const mainOf = (id: string | null) => {
    const s = get(id);
    return s ? (s.parentId ?? s.id) : null;
  };
  const subOf = (id: string | null) => (get(id)?.parentId ? id : null);

  return {
    mains,
    subs: (mainId) => children.get(mainId) ?? [],
    get,
    mainOf,
    subOf,
    label: (id) => {
      const s = get(id);
      if (!s) return "";
      const parent = s.parentId ? get(s.parentId) : undefined;
      return parent ? `${parent.name} › ${s.name}` : s.name;
    },
    code: (systemId, mfrPartNumber) =>
      [shortCode(get(mainOf(systemId))), shortCode(get(subOf(systemId))), mfrPartNumber.trim()].filter(Boolean).join("-"),
    within: (partSystemId, filterId) => !!partSystemId && (partSystemId === filterId || get(partSystemId)?.parentId === filterId),
    options: () =>
      mains.flatMap((m) => [
        { value: m.id, label: m.name, active: m.active, sub: false },
        ...(children.get(m.id) ?? []).map((s) => ({ value: s.id, label: `— ${s.name}`, active: s.active && m.active, sub: true })),
      ]),
  };
}
