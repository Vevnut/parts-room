import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  PartIdTakenError,
  BinCodeTakenError,
  BinNotEmptyError,
  assignBin,
  clearDraft,
  deleteBin,
  deletePart,
  ensureSeeded,
  exportBackup,
  importBackup,
  loadDraft,
  putAwayBin,
  quickAdd,
  saveBin,
  saveDraft,
  savePart,
  setMovedBack,
  suggestPartId,
} from "./repo";

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureSeeded();
});

const systemId = async () => (await db.systems.orderBy("sortOrder").first())!.id;

describe("seeding", () => {
  it("adds the 13 systems from the spreadsheet once", async () => {
    await ensureSeeded();
    expect(await db.systems.count()).toBe(13);
  });
});

describe("Part IDs", () => {
  it("quick add assigns MP-0001, MP-0002 and flags the part as needing details", async () => {
    const sys = await systemId();
    const a = await quickAdd({ name: "Impeller", systemId: sys, qty: 2, disposition: "Keep" });
    const b = await quickAdd({ name: "Fuel filter", systemId: sys, qty: 1, disposition: null });
    expect([a.partId, b.partId]).toEqual(["MP-0001", "MP-0002"]);
    expect(a.needsDetails).toBe(true);
  });

  it("rejects a duplicate Part ID regardless of case or spaces", async () => {
    await savePart({ partId: "MP-0007", name: "A", qty: 1 });
    await expect(savePart({ partId: " mp-0007 ", name: "B", qty: 1 })).rejects.toBeInstanceOf(PartIdTakenError);
  });

  it("lets a part keep its own ID when edited", async () => {
    const p = await savePart({ partId: "MP-0001", name: "A", qty: 1 });
    const edited = await savePart({ ...p, name: "A2" });
    expect(edited.name).toBe("A2");
    expect(edited.partId).toBe("MP-0001");
  });

  it("frees a deleted part's ID for manual reuse but never auto-assigns it again", async () => {
    const p = await quickAdd({ name: "A", systemId: null, qty: 1, disposition: null });
    await deletePart(p.id);
    expect(await suggestPartId()).toBe("MP-0002");
    await expect(savePart({ partId: "MP-0001", name: "Retyped", qty: 1 })).resolves.toBeTruthy();
  });
});

describe("saving parts", () => {
  it("validates before saving", async () => {
    await expect(savePart({ partId: "", name: "", qty: -1 })).rejects.toThrow();
  });

  it("clears the bin and moved-back when a part becomes Toss or Donate/Sell", async () => {
    const bin = await saveBin({ binCode: "A1-01" });
    const p = await savePart({ partId: "MP-1", name: "A", qty: 1, binId: bin.id, movedBack: true });
    const tossed = await savePart({ ...p, disposition: "Toss" });
    expect(tossed.binId).toBeNull();
    expect(tossed.movedBack).toBe(false);
  });

  it("blocks moved back without a bin", async () => {
    const p = await savePart({ partId: "MP-1", name: "A", qty: 1 });
    await expect(setMovedBack(p.id, true)).rejects.toThrow(/bin/i);
  });
});

describe("bins", () => {
  it("rejects a duplicate bin code regardless of case", async () => {
    await saveBin({ binCode: "A1-01" });
    await expect(saveBin({ binCode: "a1-01" })).rejects.toBeInstanceOf(BinCodeTakenError);
  });

  it("stores bin codes upper-cased", async () => {
    expect((await saveBin({ binCode: " b2-03 " })).binCode).toBe("B2-03");
  });

  it("assigns several parts at once, and refuses not-kept parts", async () => {
    const bin = await saveBin({ binCode: "A1-01" });
    const a = await savePart({ partId: "MP-1", name: "A", qty: 1 });
    const b = await savePart({ partId: "MP-2", name: "B", qty: 1 });
    const t = await savePart({ partId: "MP-3", name: "T", qty: 1, disposition: "Toss" });
    const n = await assignBin([a.id, b.id, t.id], bin.id);
    expect(n).toBe(2);
    expect((await db.parts.get(a.id))!.binId).toBe(bin.id);
    expect((await db.parts.get(t.id))!.binId).toBeNull();
  });

  it("removing a part from its bin also clears moved back", async () => {
    const bin = await saveBin({ binCode: "A1-01" });
    const a = await savePart({ partId: "MP-1", name: "A", qty: 1, binId: bin.id, movedBack: true });
    await assignBin([a.id], null);
    expect((await db.parts.get(a.id))!.movedBack).toBe(false);
  });

  it("puts away every part in a bin", async () => {
    const bin = await saveBin({ binCode: "A1-01" });
    await savePart({ partId: "MP-1", name: "A", qty: 1, binId: bin.id });
    await savePart({ partId: "MP-2", name: "B", qty: 1, binId: bin.id });
    expect(await putAwayBin(bin.id)).toBe(2);
    expect((await db.parts.toArray()).every((p) => p.movedBack)).toBe(true);
  });

  it("won't delete a bin that still has parts", async () => {
    const bin = await saveBin({ binCode: "A1-01" });
    const p = await savePart({ partId: "MP-1", name: "A", qty: 1, binId: bin.id });
    await expect(deleteBin(bin.id)).rejects.toBeInstanceOf(BinNotEmptyError);
    await deletePart(p.id);
    await expect(deleteBin(bin.id)).resolves.toBeUndefined();
  });
});

describe("drafts", () => {
  it("keeps an unsaved form across reloads until cleared", async () => {
    await saveDraft("quick-add", { name: "Half typed" });
    expect(await loadDraft("quick-add")).toEqual({ name: "Half typed" });
    await clearDraft("quick-add");
    expect(await loadDraft("quick-add")).toBeNull();
  });
});

describe("backup", () => {
  it("round-trips: export, wipe, restore gives the same data", async () => {
    const bin = await saveBin({ binCode: "A1-01", labelText: "Impellers" });
    await savePart({ partId: "MP-1", name: "Impeller, 3\" \"blade\"", qty: 2, binId: bin.id, notes: "line1\nline2" });
    const backup = await exportBackup();
    // A restore re-stamps updatedAt so restored rows win on other devices; everything else must match.
    const snapshot = async () =>
      JSON.stringify([await db.parts.toArray(), await db.bins.toArray(), await db.systems.toArray()].map((rows) => rows.map((r) => ({ ...r, updatedAt: undefined }))));
    const before = await snapshot();
    await db.parts.clear();
    await db.bins.clear();
    await importBackup(JSON.parse(JSON.stringify(backup)));
    expect(await snapshot()).toBe(before);
  });

  it("queues every restored row for sync", async () => {
    await saveBin({ binCode: "A1-01" });
    const backup = await exportBackup();
    await db.outbox.clear();
    await importBackup(backup);
    expect(await db.outbox.count()).toBe(14); // 13 systems + 1 bin
  });

  it("refuses a file that isn't a Parts Room backup", async () => {
    await expect(importBackup({ hello: "world" })).rejects.toThrow(/backup/i);
  });
});
