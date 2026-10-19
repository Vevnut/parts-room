import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { duplicatePart, ensureSeeded, quickAdd, saveBin, savePart } from "./repo";
import { CONDITIONS, MANUFACTURERS } from "../domain/rules";
import { nextQuickAddForm } from "../domain/quickAdd";
import { sanitize } from "../../server/fields";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
});

describe("older-shop lists", () => {
  it("includes OMC, Johnson and Volvo Penta", () => {
    for (const m of ["OMC", "Johnson", "Evinrude", "Volvo Penta"]) expect(MANUFACTURERS).toContain(m);
  });
  it("has a No longer available condition the server accepts", async () => {
    expect(CONDITIONS).toContain("No longer available");
    const p = await savePart({ partId: "MP-0001", name: "Points set", qty: 1, condition: "No longer available" });
    expect(sanitize("parts", JSON.parse(JSON.stringify(p))).ok).toBe(true);
  });
});

describe("quick add with manufacturer and old location", () => {
  it("stores them, trimmed", async () => {
    const p = await quickAdd({ name: "Gasket set", systemId: null, qty: 1, disposition: null, manufacturer: " OMC ", oldLocation: " Misc bin 7 " });
    expect(p).toMatchObject({ manufacturer: "OMC", oldLocation: "Misc bin 7" });
  });

  it("keeps system, manufacturer and old location for the next part; clears the rest", () => {
    const next = nextQuickAddForm({ name: "Gasket set", mfrPartNumber: "0388xxx", manufacturer: "OMC", oldLocation: "Misc bin 7", systemId: "engine-propulsion", qty: 4, disposition: "Unknown" });
    expect(next).toEqual({ name: "", mfrPartNumber: "", manufacturer: "OMC", oldLocation: "Misc bin 7", systemId: "engine-propulsion", qty: 1, disposition: "Keep" });
  });
});

describe("duplicatePart", () => {
  it("copies a part under the next Part ID, flagged for details, without its put-away state", async () => {
    const bin = await saveBin({ binCode: "A1-01" });
    const lot = await savePart({ partId: "MP-0001", name: "Assorted OMC gaskets", qty: 12, manufacturer: "OMC", oldLocation: "Misc bin 7", binId: bin.id, movedBack: true, retailPrice: 30 });
    const copy = await duplicatePart(lot.id);
    expect(copy.id).not.toBe(lot.id);
    expect(copy).toMatchObject({ partId: "MP-0002", name: "Assorted OMC gaskets", manufacturer: "OMC", oldLocation: "Misc bin 7", binId: bin.id, movedBack: false, needsDetails: true, qty: 1 });
    expect(await db.outbox.get(["parts", copy.id])).toBeTruthy();
  });
});
