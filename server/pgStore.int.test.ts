// Runs only when TEST_DATABASE_URL points at a throwaway Neon branch/database:
//   TEST_DATABASE_URL=postgres://... npm test
// It deletes everything in the parts, bins, systems and login_failures tables of that database.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgStore } from "./pgStore";
import type { Cursor, WireRow } from "./store";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgStore against Postgres", () => {
  const sql = neon(url ?? "postgres://unused:unused@localhost/unused");
  let store: PgStore;
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const part = (over: Record<string, unknown> = {}): WireRow => ({
    id: uuid(), partId: `MP-${n}`, name: "Impeller", systemId: "engine-propulsion", qty: 1.5, condition: "New", disposition: null,
    oldLocation: "Shelf 3", binId: null, movedBack: false, manufacturer: "Mercury", mfrPartNumber: "47-43026Q06", supplier: "",
    minQty: 2, reorderQty: null, unitCost: 28.5, retailPrice: null, lastCounted: "2026-10-18", replaceBy: null, photoLink: "",
    notes: "line1\nline2", needsDetails: true, createdAt: "2026-10-19T11:00:00.000Z", updatedAt: "2026-10-19T11:00:00.000Z", deletedAt: null,
    ...over,
  });

  beforeAll(async () => {
    const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const s of statements) await sql(s, []);
    store = new PgStore(url!);
  });
  beforeEach(async () => {
    await sql("truncate parts, bins, systems, login_failures", []);
  });

  it("round-trips every field with the same JSON types", async () => {
    const p = part();
    expect(await store.upsert("parts", p)).toBe("ok");
    const { rows } = await store.changedSince("parts", null, 10);
    expect(rows[0]).toEqual(p);
  });

  it("applies last-write-wins and unique live Part IDs", async () => {
    const p = part({ updatedAt: "2026-10-19T11:05:00.000Z" });
    await store.upsert("parts", p);
    expect(await store.upsert("parts", { ...p, name: "old", updatedAt: "2026-10-19T11:00:00.000Z" })).toBe("stale");
    expect(await store.upsert("parts", part({ partId: ` ${String(p.partId).toLowerCase()}` }))).toBe("conflict");
    await store.upsert("parts", { ...p, deletedAt: "2026-10-19T11:10:00.000Z", updatedAt: "2026-10-19T11:10:00.000Z" });
    expect(await store.upsert("parts", part({ partId: p.partId }))).toBe("ok");
  });

  it("pages in (server time, id) order with an exact cursor", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = part();
      ids.push(p.id);
      await store.upsert("parts", p);
    }
    const seen: string[] = [];
    let after: Cursor | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await store.changedSince("parts", after, 2);
      seen.push(...page.rows.map((r) => r.id));
      if (!page.last) break;
      after = page.last;
    }
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(5);
  });

  it("counts and clears failed logins", async () => {
    const now = Date.now();
    await store.recordFailedLogin("ip:1", now);
    await store.recordFailedLogin("ip:1", now);
    expect(await store.countFailedLogins("ip:1", now - 1000)).toBe(2);
    await store.clearFailedLogins("ip:1");
    expect(await store.countFailedLogins("ip:1", now - 1000)).toBe(0);
  });
});
