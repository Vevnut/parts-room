import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { assignBin, ensureSeeded, quickAdd, saveBin, setMovedBack, updateParts } from "./repo";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
});

const add = (name: string) => quickAdd({ name, systemId: "fuel-system", qty: 1, disposition: "Keep", manufacturer: "Mercury", oldLocation: "Shelf 1" });

describe("changing many parts at once", () => {
  it("applies only the fields given to every chosen part and queues them for sync", async () => {
    const a = await add("A");
    const b = await add("B");
    const c = await add("C");
    await db.outbox.clear();
    const n = await updateParts([a.id, b.id], { systemId: "other", condition: "New", oldLocation: "  MERC MISC 1 ", needsDetails: false });
    expect(n).toBe(2);
    for (const id of [a.id, b.id]) {
      const p = (await db.parts.get(id))!;
      expect(p).toMatchObject({ systemId: "other", condition: "New", oldLocation: "MERC MISC 1", needsDetails: false, manufacturer: "Mercury", disposition: "Keep" });
      expect(p.updatedAt >= a.updatedAt).toBe(true);
    }
    expect((await db.parts.get(c.id))!).toMatchObject({ systemId: "fuel-system", oldLocation: "Shelf 1" });
    expect((await db.outbox.toArray()).map((e) => e.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("can clear a system or condition", async () => {
    const a = await add("A");
    await updateParts([a.id], { systemId: null, condition: null });
    expect((await db.parts.get(a.id))!).toMatchObject({ systemId: null, condition: null });
  });

  it("takes a part out of its bin when it's marked Toss or Donate/Sell", async () => {
    const bin = await saveBin({ binCode: "A1-01" });
    const a = await add("A");
    await assignBin([a.id], bin.id);
    await setMovedBack(a.id, true);
    await updateParts([a.id], { disposition: "Toss" });
    expect((await db.parts.get(a.id))!).toMatchObject({ disposition: "Toss", binId: null, movedBack: false });
  });

  it("skips deleted or missing parts and does nothing with an empty change", async () => {
    const a = await add("A");
    await db.parts.update(a.id, { deletedAt: "2026-10-23T00:00:00.000Z" });
    expect(await updateParts([a.id, "missing"], { condition: "New" })).toBe(0);
    const b = await add("B");
    await db.outbox.clear();
    expect(await updateParts([b.id], {})).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
