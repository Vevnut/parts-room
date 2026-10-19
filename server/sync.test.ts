// Server side of sync, run against the in-memory store. The Postgres store must behave the same.
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memoryStore.js";
import { HttpError, handleSync } from "./syncHandler.js";
import type { Bin, Part } from "../src/domain/rules.js";

let clock = Date.parse("2026-10-19T12:00:00.000Z");
const later = (ms = 1000) => (clock += ms);
let store: MemoryStore;
beforeEach(() => {
  clock = Date.parse("2026-10-19T12:00:00.000Z");
  store = new MemoryStore(() => clock);
});

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
function part(over: Partial<Part> = {}): Part {
  return {
    id: uuid(),
    partId: `MP-${String(n).padStart(4, "0")}`,
    name: "Impeller",
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
    createdAt: "2026-10-19T11:00:00.000Z",
    updatedAt: "2026-10-19T11:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}
function bin(over: Partial<Bin> = {}): Bin {
  return { id: uuid(), binCode: "A1-01", shelfZone: "", binSize: "", labelText: "", createdAt: "2026-10-19T11:00:00.000Z", updatedAt: "2026-10-19T11:00:00.000Z", deletedAt: null, ...over };
}
const push = (...items: { table: string; row: unknown }[]) => handleSync(store, { push: items, cursors: {} });

describe("pushing", () => {
  it("accepts a new part and returns it on pull", async () => {
    const p = part();
    const res = await push({ table: "parts", row: p });
    expect(res.results).toEqual([{ table: "parts", id: p.id, status: "ok" }]);
    expect(res.rows.parts.map((r) => r.id)).toContain(p.id);
    expect(res.cursors.parts).toBeTruthy();
  });

  it("keeps the newer edit when an older one arrives late (last write wins)", async () => {
    const p = part({ updatedAt: "2026-10-19T11:05:00.000Z", name: "Newer" });
    await push({ table: "parts", row: p });
    const res = await push({ table: "parts", row: { ...p, name: "Older", updatedAt: "2026-10-19T11:01:00.000Z" } });
    expect(res.results[0].status).toBe("stale");
    expect(res.rows.parts.find((r) => r.id === p.id)?.name).toBe("Newer");
  });

  it("treats a replay of the same edit as ok", async () => {
    const p = part();
    await push({ table: "parts", row: p });
    expect((await push({ table: "parts", row: p })).results[0].status).toBe("ok");
  });

  it("rejects a Part ID another live part already uses, regardless of case", async () => {
    await push({ table: "parts", row: part({ partId: "MP-0100" }) });
    const res = await push({ table: "parts", row: part({ partId: " mp-0100" }) });
    expect(res.results[0].status).toBe("conflict");
  });

  it("lets a deleted part's ID be used again", async () => {
    const a = part({ partId: "MP-0200" });
    await push({ table: "parts", row: a });
    await push({ table: "parts", row: { ...a, deletedAt: "2026-10-19T11:30:00.000Z", updatedAt: "2026-10-19T11:30:00.000Z" } });
    expect((await push({ table: "parts", row: part({ partId: "MP-0200" }) })).results[0].status).toBe("ok");
  });

  it("rejects a duplicate bin code", async () => {
    await push({ table: "bins", row: bin({ binCode: "B1-01" }) });
    expect((await push({ table: "bins", row: bin({ binCode: "b1-01" }) })).results[0].status).toBe("conflict");
  });

  it("marks malformed rows invalid without failing the rest", async () => {
    const good = part();
    const res = await push(
      { table: "parts", row: { ...part(), id: "not-a-uuid" } },
      { table: "parts", row: part({ qty: -3 }) },
      { table: "parts", row: { ...part(), name: 42 } },
      { table: "parts", row: good },
    );
    expect(res.results.map((r) => r.status)).toEqual(["invalid", "invalid", "invalid", "ok"]);
  });

  it("stores only known fields", async () => {
    const p = { ...part(), partKey: "X", evil: "<script>" };
    await push({ table: "parts", row: p });
    const saved = (await handleSync(store, { push: [], cursors: {} })).rows.parts[0] as unknown as Record<string, unknown>;
    expect(saved.evil).toBeUndefined();
    expect(saved.partKey).toBeUndefined();
  });

  it("rejects unknown tables and oversized or malformed requests", async () => {
    await expect(push({ table: "users", row: {} })).rejects.toBeInstanceOf(HttpError);
    await expect(handleSync(store, { push: Array.from({ length: 501 }, () => ({ table: "parts", row: part() })), cursors: {} })).rejects.toBeInstanceOf(HttpError);
    await expect(handleSync(store, "nope")).rejects.toBeInstanceOf(HttpError);
    await expect(handleSync(store, { push: "x", cursors: {} })).rejects.toBeInstanceOf(HttpError);
  });
});

describe("pulling", () => {
  it("returns rows changed since the cursor, re-reading only the last few seconds", async () => {
    const old = part();
    await push({ table: "parts", row: old });
    later(60_000);
    const a = part();
    const first = await push({ table: "parts", row: a }); // cursor now sits on a
    later(60_000);
    const b = part();
    await push({ table: "parts", row: b });
    const res = await handleSync(store, { push: [], cursors: first.cursors });
    expect(res.rows.parts.map((r) => r.id)).toEqual([a.id, b.id]); // a is inside the overlap; old is not
  });

  it("pages large pulls and says there is more", async () => {
    for (let i = 0; i < 5; i++) {
      await push({ table: "parts", row: part() });
      later();
    }
    const page1 = await handleSync(store, { push: [], cursors: {}, limit: 2 });
    expect(page1.rows.parts).toHaveLength(2);
    expect(page1.more).toBe(true);
  });

  it("walks every page exactly once when continuing", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = part();
      ids.push(p.id);
      await push({ table: "parts", row: p });
      // all inside the 5-second overlap window, the case that could loop forever
    }
    const seen: string[] = [];
    let cursors = {};
    let cont = false;
    for (let guard = 0; guard < 10; guard++) {
      const page = await handleSync(store, { push: [], cursors, limit: 2, continue: cont });
      seen.push(...page.rows.parts.map((r) => r.id));
      cursors = page.cursors;
      cont = true;
      if (!page.more) break;
    }
    expect(seen).toEqual(ids);
  });

  it("returns deleted rows so other devices remove them", async () => {
    const a = part();
    await push({ table: "parts", row: a });
    later();
    const res = await push({ table: "parts", row: { ...a, deletedAt: "2026-10-19T11:30:00.000Z", updatedAt: "2026-10-19T11:30:00.000Z" } });
    expect(res.rows.parts.find((r) => r.id === a.id)?.deletedAt).toBe("2026-10-19T11:30:00.000Z");
  });

  it("refuses a system with a blank name", async () => {
    const res = await push({ table: "systems", row: { id: "blank", name: "  ", sortOrder: 1, active: true } });
    expect(res.results[0].status).toBe("invalid");
  });

  it("syncs systems by their slug ids", async () => {
    const res = await push({ table: "systems", row: { id: "fuel-system", name: "Fuel System", sortOrder: 4, active: true } });
    expect(res.results[0].status).toBe("ok");
    expect(res.rows.systems[0].name).toBe("Fuel System");
  });
});
