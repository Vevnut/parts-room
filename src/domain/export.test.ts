import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_COLUMNS, buildExport, loadColumns, toCsv, type ExportColumn } from "./export";
import type { Bin, Part } from "./rules";

let n = 0;
function part(over: Partial<Part> = {}): Part {
  n += 1;
  return {
    id: `p${n}`, partId: `MP-${String(n).padStart(4, "0")}`, name: "Part", systemId: null, qty: 1, condition: null, disposition: null,
    oldLocation: "", binId: null, movedBack: false, manufacturer: "", mfrPartNumber: `NUM-${n}`, supplier: "", minQty: null, reorderQty: null,
    unitCost: null, retailPrice: null, lastCounted: null, replaceBy: null, photoLink: "", notes: "", needsDetails: false,
    createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", deletedAt: null, ...over,
  };
}
const bin = { id: "b1", binCode: "A-01-03", deletedAt: null } as Bin;
const defaults = { keptOnly: true, numberedOnly: true, skipZeroQty: false };

describe("Lightspeed export rows", () => {
  it("maps each part to the default columns, text stays text and numbers stay numbers", () => {
    const p = part({
      name: "Water pump impeller", mfrPartNumber: " 0047-43026Q06 ", manufacturer: "Mercury", supplier: "", qty: 3,
      unitCost: 28.5, retailPrice: 42, binId: "b1", minQty: 2, reorderQty: 4, condition: "New", notes: "Box 2",
    });
    const out = buildExport([p], [bin], DEFAULT_EXPORT_COLUMNS, defaults);
    expect(out.header).toEqual(["Part Number", "Supplier", "Manufacturer", "Description", "Qty On Hand", "Cost", "List Price", "Bin Location", "Min Qty", "Reorder Qty", "Condition", "Internal ID", "Notes"]);
    expect(out.rows).toEqual([["0047-43026Q06", "Mercury", "Mercury", "Water pump impeller", 3, 28.5, 42, "A-01-03", 2, 4, "New", p.partId, "Box 2"]]);
  });

  it("uses the supplier when one is set, and leaves blanks for unknown values", () => {
    const p = part({ supplier: "MER", manufacturer: "Mercury", unitCost: null, binId: "gone" });
    const [row] = buildExport([p], [bin], DEFAULT_EXPORT_COLUMNS, defaults).rows;
    expect(row[1]).toBe("MER");
    expect(row[5]).toBeNull();
    expect(row[7]).toBe("");
  });

  it("leaves out deleted, not-kept and unnumbered parts and counts why", () => {
    const parts = [
      part({ name: "keep" }),
      part({ name: "blank disposition counts as kept", disposition: null }),
      part({ name: "unknown counts as kept", disposition: "Unknown" }),
      part({ name: "toss", disposition: "Toss" }),
      part({ name: "sell", disposition: "Donate/Sell" }),
      part({ name: "no number", mfrPartNumber: "  " }),
      part({ name: "deleted", deletedAt: "2026-10-19T01:00:00.000Z" }),
      part({ name: "none left", qty: 0 }),
    ];
    const out = buildExport(parts, [], DEFAULT_EXPORT_COLUMNS, defaults);
    expect(out.rows.map((r) => r[3]).sort()).toEqual(["blank disposition counts as kept", "keep", "none left", "unknown counts as kept"]);
    expect(out.skipped).toEqual({ notKept: 2, noNumber: 1, zeroQty: 0 });

    const all = buildExport(parts, [], DEFAULT_EXPORT_COLUMNS, { keptOnly: false, numberedOnly: false, skipZeroQty: true });
    expect(all.rows).toHaveLength(6);
    expect(all.skipped).toEqual({ notKept: 0, noNumber: 0, zeroQty: 1 });
  });

  it("sorts by part number so the sheet is easy to check against Lightspeed", () => {
    const out = buildExport([part({ mfrPartNumber: "b-2" }), part({ mfrPartNumber: "A-10" }), part({ mfrPartNumber: "A-9" })], [], DEFAULT_EXPORT_COLUMNS, defaults);
    expect(out.rows.map((r) => r[0])).toEqual(["A-9", "A-10", "b-2"]);
  });

  it("follows the chosen columns, order and header names", () => {
    const cols: ExportColumn[] = [
      { key: "qty", header: "OnHand", enabled: true },
      { key: "mfrPartNumber", header: "PartNo", enabled: true },
      { key: "name", header: "Desc", enabled: false },
    ];
    const out = buildExport([part({ mfrPartNumber: "X1", qty: 2 })], [], cols, defaults);
    expect(out.header).toEqual(["OnHand", "PartNo"]);
    expect(out.rows).toEqual([[2, "X1"]]);
  });
});

describe("saved column settings", () => {
  it("falls back to the defaults for missing or broken settings", () => {
    expect(loadColumns(undefined)).toEqual(DEFAULT_EXPORT_COLUMNS);
    expect(loadColumns("nonsense")).toEqual(DEFAULT_EXPORT_COLUMNS);
  });
  it("keeps the saved order and names, drops unknown keys, appends new columns switched off", () => {
    const saved = [
      { key: "qty", header: "OnHand", enabled: true },
      { key: "bogus", header: "x", enabled: true },
      { key: "mfrPartNumber", header: "", enabled: true },
    ];
    const cols = loadColumns(saved);
    expect(cols.slice(0, 2)).toEqual([
      { key: "qty", header: "OnHand", enabled: true },
      { key: "mfrPartNumber", header: "Part Number", enabled: true },
    ]);
    expect(cols).toHaveLength(DEFAULT_EXPORT_COLUMNS.length);
    expect(cols.slice(2).every((c) => !c.enabled)).toBe(true);
  });
});

describe("CSV", () => {
  it("quotes commas, quotes and line breaks, and starts with a BOM for Excel", () => {
    const csv = toCsv(["A", "B"], [["1,2", 'say "hi"'], ["line1\nline2", 3.5], [null, ""]]);
    expect(csv).toBe('﻿A,B\r\n"1,2","say ""hi"""\r\n"line1\nline2",3.5\r\n,\r\n');
  });
  it("defuses text that a spreadsheet would run as a formula", () => {
    expect(toCsv(["A"], [["=HYPERLINK(1)"], ["+1"], ["@x"], ["-12"]])).toBe("﻿A\r\n'=HYPERLINK(1)\r\n'+1\r\n'@x\r\n-12\r\n");
  });
});
