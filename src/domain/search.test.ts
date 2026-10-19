import { describe, expect, it } from "vitest";
import { filterParts, manufacturerOptions, type PartFilters } from "./search";
import type { Part } from "./rules";

let n = 0;
function part(over: Partial<Part> = {}): Part {
  n += 1;
  return {
    id: `p${n}`, partId: `MP-${String(n).padStart(4, "0")}`, name: "Part", systemId: null, qty: 1, condition: null, disposition: null,
    oldLocation: "", binId: null, movedBack: false, manufacturer: "", mfrPartNumber: "", supplier: "", minQty: null, reorderQty: null,
    unitCost: null, retailPrice: null, lastCounted: null, replaceBy: null, photoLink: "", notes: "", needsDetails: false,
    createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", deletedAt: null, ...over,
  };
}
const none: PartFilters = {};
const names = (ps: Part[]) => ps.map((p) => p.name);

const mercury = part({ name: "Impeller", manufacturer: "Mercury" });
const mercuryLower = part({ name: "Thermostat", manufacturer: " mercury " });
const yamaha = part({ name: "Fuel filter", manufacturer: "Yamaha", mfrPartNumber: "69J-24563-00" });
const blank = part({ name: "Hose clamp", manufacturer: "" });
const all = [mercury, mercuryLower, yamaha, blank];

describe("manufacturer filter", () => {
  it("matches regardless of case and stray spaces", () => {
    expect(names(filterParts(all, { mfr: "Mercury" }))).toEqual(["Impeller", "Thermostat"]);
    expect(names(filterParts(all, { mfr: "YAMAHA" }))).toEqual(["Fuel filter"]);
  });
  it("can show parts with no manufacturer", () => {
    expect(names(filterParts(all, { mfr: "none" }))).toEqual(["Hose clamp"]);
  });
  it("combines with the other filters and the search box", () => {
    expect(names(filterParts(all, { mfr: "Mercury", q: "thermo" }))).toEqual(["Thermostat"]);
  });
});

describe("search box", () => {
  it("finds parts by manufacturer name, part number or Part ID", () => {
    expect(names(filterParts(all, { q: "yamaha" }))).toEqual(["Fuel filter"]);
    expect(names(filterParts(all, { q: "69j-245" }))).toEqual(["Fuel filter"]);
    expect(names(filterParts(all, { q: yamaha.partId.toLowerCase() }))).toEqual(["Fuel filter"]);
  });
  it("returns everything with no filters", () => {
    expect(filterParts(all, none)).toHaveLength(4);
  });
});

describe("manufacturerOptions", () => {
  it("lists each manufacturer once with a count, using the most common spelling, A to Z", () => {
    const extra = part({ manufacturer: "Mercury" });
    expect(manufacturerOptions([...all, extra])).toEqual([
      { value: "mercury", label: "Mercury", count: 3 },
      { value: "yamaha", label: "Yamaha", count: 1 },
    ]);
  });
  it("prefers the capitalized spelling when spellings are used equally", () => {
    expect(manufacturerOptions([mercuryLower, mercury])[0].label).toBe("Mercury");
  });
  it("leaves out parts with no manufacturer", () => {
    expect(manufacturerOptions(all).some((o) => o.label === "")).toBe(false);
  });
});
