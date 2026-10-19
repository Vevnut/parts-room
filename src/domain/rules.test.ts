// Cases mirror the formulas in Parts_Room_Master_List.xlsx (Master List J/Q/R, Bins E-G,
// Summary B3-B10 and rows 14-31, Reorder List). If a test here disagrees with the
// spreadsheet, the spreadsheet is right.
import { describe, expect, it } from "vitest";
import {
  binStats,
  isKept,
  nextPartId,
  normalizePartId,
  placementOf,
  reorderList,
  statusOf,
  summarize,
  totalValue,
  validatePart,
  type Part,
} from "./rules";

let n = 0;
function part(over: Partial<Part> = {}): Part {
  n += 1;
  return {
    id: `p${n}`,
    partId: `MP-${String(n).padStart(4, "0")}`,
    name: "Part",
    systemId: null,
    qty: 1,
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
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

// Row 2 of the Master List, the spreadsheet's own sample.
const sample = part({
  partId: "MP-0001",
  name: "Raw water pump impeller",
  systemId: "engine",
  qty: 1,
  condition: "New",
  disposition: "Keep",
  oldLocation: "Shelf 3 left",
  binId: "binA101",
  minQty: 2,
  reorderQty: 3,
  unitCost: 28.5,
});

describe("sample row matches the spreadsheet's results", () => {
  it("is Staged, worth $28.50, Reorder, est. reorder cost $85.50", () => {
    expect(placementOf(sample)).toBe("Staged");
    expect(totalValue(sample)).toBe(28.5);
    expect(statusOf(sample)).toBe("Reorder");
    expect(reorderList([sample]).totalCost).toBe(85.5);
  });
});

describe("isKept", () => {
  it.each([
    [null, true],
    ["Keep", true],
    ["Unknown", true],
    ["Toss", false],
    ["Donate/Sell", false],
  ] as const)("disposition %s -> kept %s", (disposition, kept) => {
    expect(isKept(part({ disposition }))).toBe(kept);
  });
});

describe("statusOf", () => {
  it("Toss and Donate/Sell are Not kept even at zero qty", () => {
    expect(statusOf(part({ disposition: "Toss", qty: 0 }))).toBe("Not kept");
    expect(statusOf(part({ disposition: "Donate/Sell", qty: 5, minQty: 10 }))).toBe("Not kept");
  });
  it("kept part at zero is Out of stock, ahead of Reorder", () => {
    expect(statusOf(part({ qty: 0, minQty: 2 }))).toBe("Out of stock");
    expect(statusOf(part({ qty: 0 }))).toBe("Out of stock");
  });
  it("Reorder at or below min qty", () => {
    expect(statusOf(part({ qty: 2, minQty: 2 }))).toBe("Reorder");
    expect(statusOf(part({ qty: 1.5, minQty: 2 }))).toBe("Reorder");
    expect(statusOf(part({ qty: 3, minQty: 2 }))).toBe("OK");
  });
  it("blank min qty never triggers Reorder; min qty 0 only matters at zero", () => {
    expect(statusOf(part({ qty: 1, minQty: null }))).toBe("OK");
    expect(statusOf(part({ qty: 1, minQty: 0 }))).toBe("OK");
  });
  it("Unknown disposition is treated as kept", () => {
    expect(statusOf(part({ disposition: "Unknown", qty: 0 }))).toBe("Out of stock");
  });
});

describe("placementOf", () => {
  it("not kept -> n/a", () => {
    expect(placementOf(part({ disposition: "Toss", binId: "b" }))).toBe("n/a");
  });
  it("no bin -> Needs bin; bin -> Staged; moved back -> Put away", () => {
    expect(placementOf(part())).toBe("Needs bin");
    expect(placementOf(part({ binId: "b" }))).toBe("Staged");
    expect(placementOf(part({ binId: "b", movedBack: true }))).toBe("Put away");
  });
  it("moved back is checked before the bin, as in the spreadsheet", () => {
    expect(placementOf(part({ binId: null, movedBack: true }))).toBe("Put away");
  });
});

describe("totalValue", () => {
  it("is qty x unit cost, blank cost counts as 0", () => {
    expect(totalValue(part({ qty: 3, unitCost: 2.25 }))).toBe(6.75);
    expect(totalValue(part({ qty: 3, unitCost: null }))).toBe(0);
  });
  it("rounds to cents", () => {
    expect(totalValue(part({ qty: 3, unitCost: 0.1 }))).toBe(0.3);
  });
});

describe("summarize", () => {
  const systems = [
    { id: "engine", name: "Engine & Propulsion", sortOrder: 1, active: true },
    { id: "elec", name: "Electrical (AC/DC)", sortOrder: 2, active: true },
  ];
  const parts = [
    part({ systemId: "engine", qty: 2, unitCost: 10, binId: "b", movedBack: true }), // kept, put away
    part({ systemId: "engine", qty: 0, binId: "b" }), // kept, staged, out of stock
    part({ systemId: "elec", qty: 1, minQty: 1, unitCost: 5 }), // kept, needs bin, reorder
    part({ systemId: "elec", disposition: "Toss", qty: 4, unitCost: 100 }), // not kept
    part({ systemId: "engine", disposition: "Donate/Sell" }), // not kept
    part({ systemId: null, disposition: "Unknown", qty: 1 }), // kept (unknown), needs bin, no system
    part({ systemId: "engine", deletedAt: "2026-10-18T01:00:00.000Z" }), // deleted: ignored
  ];
  const s = summarize(parts, systems);

  it("counts progress like Summary B3-B10", () => {
    expect(s.logged).toBe(6);
    expect(s.notKept).toBe(2);
    expect(s.kept).toBe(4);
    expect(s.needsBin).toBe(2);
    expect(s.staged).toBe(1);
    expect(s.putAway).toBe(1);
    expect(s.pctPutAway).toBeCloseTo(0.25);
    expect(s.unknown).toBe(1);
  });
  it("stock value excludes not-kept parts", () => {
    expect(s.stockValue).toBe(25);
  });
  it("breaks down kept parts by system, with a no-system remainder", () => {
    const engine = s.bySystem.find((r) => r.systemId === "engine")!;
    expect(engine).toMatchObject({ keptParts: 2, units: 2, value: 20, needsBin: 0, reorder: 0, outOfStock: 1 });
    const elec = s.bySystem.find((r) => r.systemId === "elec")!;
    expect(elec).toMatchObject({ keptParts: 1, units: 1, value: 5, needsBin: 1, reorder: 1, outOfStock: 0 });
    expect(s.keptWithoutSystem).toBe(1);
  });
  it("percent done is 0 with nothing kept", () => {
    expect(summarize([], systems).pctPutAway).toBe(0);
  });
});

describe("binStats", () => {
  it("counts parts, units and not-put-away for one bin, like Bins E-G", () => {
    const parts = [
      part({ binId: "b1", qty: 2, movedBack: true }),
      part({ binId: "b1", qty: 3 }),
      part({ binId: "b2", qty: 9 }),
      part({ binId: "b1", qty: 1, deletedAt: "x" }),
    ];
    expect(binStats("b1", parts)).toEqual({ parts: 2, units: 5, notPutAway: 1, done: false });
  });
  it("is done when it has parts and all are put away", () => {
    expect(binStats("b1", [part({ binId: "b1", movedBack: true })]).done).toBe(true);
    expect(binStats("b1", []).done).toBe(false);
  });
});

describe("reorderList", () => {
  it("lists kept parts at Reorder or Out of stock with estimated cost", () => {
    const a = part({ qty: 0, reorderQty: 2, unitCost: 4 });
    const b = part({ qty: 5, minQty: 5, reorderQty: null, unitCost: 4 });
    const c = part({ qty: 9, minQty: 1 });
    const d = part({ qty: 0, disposition: "Toss", reorderQty: 1, unitCost: 1 });
    const r = reorderList([a, b, c, d]);
    expect(r.rows.map((x) => x.part.id)).toEqual([a.id, b.id]);
    expect(r.rows.map((x) => x.estCost)).toEqual([8, 0]);
    expect(r.totalCost).toBe(8);
  });
  it("has no 60-row limit", () => {
    const many = Array.from({ length: 75 }, () => part({ qty: 0 }));
    expect(reorderList(many).rows).toHaveLength(75);
  });
});

describe("Part IDs", () => {
  it("normalizes case and spaces for uniqueness", () => {
    expect(normalizePartId("  mp-0001 ")).toBe("MP-0001");
  });
  it("next ID follows the highest existing number for the prefix", () => {
    expect(nextPartId([], "MP-", 4)).toBe("MP-0001");
    expect(nextPartId(["MP-0001", "MP-0009"], "MP-", 4)).toBe("MP-0010");
    expect(nextPartId(["mp-0003", "MP-0002", "X-0099", "MP-12A"], "MP-", 4)).toBe("MP-0004");
    expect(nextPartId(["MP-9999"], "MP-", 4)).toBe("MP-10000");
  });
});

describe("validatePart", () => {
  it("requires a Part ID and a name", () => {
    expect(validatePart({ partId: " ", name: "" })).toEqual({
      partId: "Enter a Part ID.",
      name: "Enter a part name.",
    });
  });
  it("rejects negative numbers", () => {
    const e = validatePart({ partId: "MP-1", name: "x", qty: -1, unitCost: -2 });
    expect(e.qty).toBeTruthy();
    expect(e.unitCost).toBeTruthy();
  });
  it("blocks Moved back without a bin", () => {
    expect(validatePart({ partId: "MP-1", name: "x", movedBack: true, binId: null }).movedBack).toBeTruthy();
  });
  it("passes a valid part", () => {
    expect(validatePart({ partId: "MP-1", name: "x", qty: 0 })).toEqual({});
  });
});
