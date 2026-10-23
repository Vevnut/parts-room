import { describe, expect, it } from "vitest";
import { distinctOptions, filterParts, manufacturerOptions, oldBins, type PartFilters } from "./search";
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

describe("old location filter", () => {
  const a = part({ name: "Gasket set", oldLocation: "Misc bin 7" });
  const b = part({ name: "Points", oldLocation: " misc bin 7" });
  const c = part({ name: "Prop nut", oldLocation: "Shelf 3" });
  const d = part({ name: "Clamp", oldLocation: "" });
  it("matches regardless of case and spaces, or finds parts with no old location", () => {
    expect(names(filterParts([a, b, c, d], { loc: "Misc Bin 7" }))).toEqual(["Gasket set", "Points"]);
    expect(names(filterParts([a, b, c, d], { loc: "none" }))).toEqual(["Clamp"]);
  });
  it("lists old locations once each with counts", () => {
    expect(distinctOptions([a, b, c, d], "oldLocation").map((o) => `${o.label} (${o.count})`)).toEqual(["Misc bin 7 (2)", "Shelf 3 (1)"]);
  });
});

describe("no price yet filter", () => {
  it("finds parts with no retail price, leaving out tossed ones", () => {
    const priced = part({ name: "Priced", retailPrice: 40 });
    const unpriced = part({ name: "Unpriced", retailPrice: null });
    const sell = part({ name: "To sell", retailPrice: null, disposition: "Donate/Sell" });
    const toss = part({ name: "Junk", retailPrice: null, disposition: "Toss" });
    expect(names(filterParts([priced, unpriced, sell, toss], { noPrice: true }))).toEqual(["Unpriced", "To sell"]);
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

describe("old bins", () => {
  it("groups parts by old location with part, unit and value totals, ignoring case and blanks", () => {
    const ps = [
      part({ oldLocation: "MERC MISC 1", qty: 2, retailPrice: 10 }),
      part({ oldLocation: " merc  misc 1", qty: 3, retailPrice: null }),
      part({ oldLocation: "Shelf 10", qty: 1, retailPrice: 5 }),
      part({ oldLocation: "Shelf 2", qty: 4 }),
      part({ oldLocation: "" }),
    ];
    expect(oldBins(ps)).toEqual([
      { value: "merc misc 1", label: "MERC MISC 1", parts: 2, units: 5, retail: 20, unpriced: 1 },
      { value: "shelf 2", label: "Shelf 2", parts: 1, units: 4, retail: 0, unpriced: 1 },
      { value: "shelf 10", label: "Shelf 10", parts: 1, units: 1, retail: 5, unpriced: 0 },
    ]);
  });
});
