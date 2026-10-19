import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { SystemNameTakenError, addSystem, ensureSeeded, moveSystem, quickAdd, renameSystem, setSystemActive } from "./repo";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
  await db.outbox.clear();
});

const ordered = async () => (await db.systems.orderBy("sortOrder").toArray()).map((s) => s.name);

describe("adding systems", () => {
  it("adds a system at the end of the list and queues it for sync", async () => {
    const s = await addSystem("  Trailer & Towing ");
    expect(s).toMatchObject({ id: "trailer-towing", name: "Trailer & Towing", active: true, sortOrder: 14 });
    expect((await ordered()).at(-1)).toBe("Trailer & Towing");
    expect(await db.outbox.get(["systems", s.id])).toBeTruthy();
  });

  it("refuses a blank name or one already in the list, ignoring case", async () => {
    await expect(addSystem("   ")).rejects.toThrow(/name/i);
    await expect(addSystem("fuel system")).rejects.toBeInstanceOf(SystemNameTakenError);
  });

  it("gives a new id when the natural one is taken by a renamed system", async () => {
    await renameSystem("other", "Miscellaneous");
    const s = await addSystem("Other");
    expect(s.id).toBe("other-2");
  });
});

describe("editing systems", () => {
  it("renames a system without changing its id, so parts keep their system", async () => {
    const p = await quickAdd({ name: "Filter", systemId: "fuel-system", qty: 1, disposition: null });
    await renameSystem("fuel-system", "Fuel & Filters");
    expect((await db.systems.get("fuel-system"))!.name).toBe("Fuel & Filters");
    expect((await db.parts.get(p.id))!.systemId).toBe("fuel-system");
    expect(await db.outbox.get(["systems", "fuel-system"])).toBeTruthy();
  });

  it("refuses to rename onto another system's name", async () => {
    await expect(renameSystem("other", "Fuel System")).rejects.toBeInstanceOf(SystemNameTakenError);
    await expect(renameSystem("other", "")).rejects.toThrow(/name/i);
  });

  it("allows changing only the capitalisation of a name", async () => {
    await renameSystem("other", "OTHER");
    expect((await db.systems.get("other"))!.name).toBe("OTHER");
  });

  it("hides and shows a system", async () => {
    await setSystemActive("hvac-refrigeration", false);
    expect((await db.systems.get("hvac-refrigeration"))!.active).toBe(false);
    await setSystemActive("hvac-refrigeration", true);
    expect((await db.systems.get("hvac-refrigeration"))!.active).toBe(true);
  });

  it("moves a system up and down, and stops at the ends", async () => {
    await moveSystem("electrical-ac-dc", -1);
    expect((await ordered()).slice(0, 2)).toEqual(["Electrical (AC/DC)", "Engine & Propulsion"]);
    await moveSystem("electrical-ac-dc", -1); // already first: no change
    expect((await ordered())[0]).toBe("Electrical (AC/DC)");
    await moveSystem("other", 1); // already last
    expect((await ordered()).at(-1)).toBe("Other");
    expect((await db.outbox.toArray()).map((e) => e.id).sort()).toEqual(["electrical-ac-dc", "engine-propulsion"]);
  });

  it("skips hidden systems when moving, so the move shows in the visible list", async () => {
    await setSystemActive("plumbing-water", false); // 3rd
    await moveSystem("fuel-system", -1); // 4th: should land above Electrical (2nd), past the hidden one
    const visible = (await db.systems.orderBy("sortOrder").toArray()).filter((s) => s.active).map((s) => s.name);
    expect(visible.slice(0, 3)).toEqual(["Engine & Propulsion", "Fuel System", "Electrical (AC/DC)"]);
  });
});

describe("quick add with a part number", () => {
  it("stores the manufacturer part number when given", async () => {
    const p = await quickAdd({ name: "Impeller", systemId: null, qty: 1, disposition: "Keep", mfrPartNumber: " 47-43026Q06 " });
    expect(p.mfrPartNumber).toBe("47-43026Q06");
    expect(p.needsDetails).toBe(true);
  });
});
