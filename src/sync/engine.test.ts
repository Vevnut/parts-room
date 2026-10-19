// Two devices (phone = A, computer = B), each with its own local database, syncing through
// the real server handler backed by the in-memory store.
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { PartsDB } from "../db/db";
import { MemoryStore } from "../../server/memoryStore";
import { handleSync } from "../../server/syncHandler";
import { deletePart, ensureSeeded, quickAdd, saveBin, savePart, withDatabase } from "../db/repo";
import { syncOnce, syncStatus, type Remote } from "./engine";

let store: MemoryStore;
let A: PartsDB;
let B: PartsDB;
let tick = Date.parse("2026-10-19T12:00:00.000Z");

const wire = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const remote = (): Remote => ({ sync: async (body) => wire(await handleSync(store, wire(body))) });
const onA = <T,>(fn: () => Promise<T>) => withDatabase(A, fn);
const onB = <T,>(fn: () => Promise<T>) => withDatabase(B, fn);
const sync = (d: PartsDB, r: Remote = remote(), opts = {}) => syncOnce(r, d, opts);
const live = async (d: PartsDB) => (await d.parts.toArray()).filter((p) => !p.deletedAt);
const pause = () => new Promise((r) => setTimeout(r, 5));

beforeEach(async () => {
  store = new MemoryStore(() => (tick += 10));
  for (const d of [A, B]) if (d) await d.delete();
  A = new PartsDB("device-a");
  B = new PartsDB("device-b");
  await onA(ensureSeeded);
  await onB(ensureSeeded);
});

describe("syncing between devices", () => {
  it("sends a part logged on the phone to the computer", async () => {
    const p = await onA(() => quickAdd({ name: "Impeller", systemId: "engine-propulsion", qty: 2, disposition: "Keep" }));
    await sync(A);
    expect((await syncStatus(A)).pending).toBe(0);
    await sync(B);
    const onComputer = await B.parts.get(p.id);
    expect(onComputer).toMatchObject({ partId: "MP-0001", name: "Impeller", qty: 2 });
  });

  it("syncs bins and systems too", async () => {
    await onA(() => saveBin({ binCode: "A1-01", labelText: "Impellers" }));
    await sync(A);
    await sync(B);
    expect((await B.bins.toArray()).map((b) => b.binCode)).toEqual(["A1-01"]);
    expect(await B.systems.count()).toBe(13);
  });

  it("keeps the later edit when both devices change the same part", async () => {
    const p = await onA(() => quickAdd({ name: "Impeller", systemId: null, qty: 1, disposition: null }));
    await sync(A);
    await sync(B);
    const onBRow = (await B.parts.get(p.id))!;
    await onA(() => savePart({ ...p, name: "Edited on phone" }));
    await pause();
    await onB(() => savePart({ ...onBRow, name: "Edited on computer" }));
    await sync(A);
    await sync(B);
    await sync(A);
    expect((await A.parts.get(p.id))!.name).toBe("Edited on computer");
    expect((await B.parts.get(p.id))!.name).toBe("Edited on computer");
  });

  it("removes a part deleted on one device from the other", async () => {
    const p = await onA(() => quickAdd({ name: "Old gasket", systemId: null, qty: 1, disposition: "Toss" }));
    await sync(A);
    await sync(B);
    await onB(() => deletePart(p.id));
    await sync(B);
    await sync(A);
    expect(await live(A)).toHaveLength(0);
  });

  it("doesn't lose an edit made while a sync is in flight", async () => {
    const p = await onA(() => quickAdd({ name: "Impeller", systemId: null, qty: 1, disposition: null }));
    const slow: Remote = {
      sync: async (body) => {
        const res = await remote().sync(body);
        await pause();
        await onA(() => savePart({ ...p, name: "Changed mid-sync" })); // user keeps typing
        return res;
      },
    };
    await sync(A, slow);
    expect((await syncStatus(A)).pending).toBe(1);
    expect((await A.parts.get(p.id))!.name).toBe("Changed mid-sync");
    await sync(A);
    await sync(B);
    expect((await B.parts.get(p.id))!.name).toBe("Changed mid-sync");
  });

  it("keeps everything queued when the connection is down", async () => {
    await onA(() => quickAdd({ name: "Impeller", systemId: null, qty: 1, disposition: null }));
    const down: Remote = { sync: async () => Promise.reject(new TypeError("Failed to fetch")) };
    await expect(sync(A, down)).rejects.toThrow();
    expect((await syncStatus(A)).pending).toBeGreaterThan(0);
    await sync(A);
    expect((await syncStatus(A)).pending).toBe(0);
  });

  it("flags a Part ID both devices assigned while apart, without losing either part", async () => {
    const a = await onA(() => quickAdd({ name: "Phone part", systemId: null, qty: 1, disposition: null }));
    const b = await onB(() => quickAdd({ name: "Computer part", systemId: null, qty: 1, disposition: null }));
    expect(a.partId).toBe(b.partId); // both MP-0001
    await sync(A);
    await sync(B);
    const status = await syncStatus(B);
    expect(status.conflicts).toHaveLength(1);
    expect(status.conflicts[0]).toMatchObject({ table: "parts", id: b.id });
    expect((await live(B)).map((p) => p.name).sort()).toEqual(["Computer part", "Phone part"]);

    // Fix it on the computer by giving it a new ID; it then syncs normally.
    const mine = (await B.parts.get(b.id))!;
    await onB(() => savePart({ ...mine, partId: "MP-0002" }));
    await sync(B);
    expect((await syncStatus(B)).conflicts).toHaveLength(0);
    await sync(A);
    expect((await A.parts.get(b.id))!.partId).toBe("MP-0002");
  });

  it("pulls large sets across several pages", async () => {
    for (let i = 0; i < 7; i++) await onA(() => quickAdd({ name: `Part ${i}`, systemId: null, qty: 1, disposition: null }));
    await sync(A);
    await sync(B, remote(), { limit: 3 });
    expect(await live(B)).toHaveLength(7);
  });
});

describe("data logged before sync existed", () => {
  it("is queued for upload when the database upgrades", async () => {
    const name = "device-legacy";
    await Dexie.delete(name);
    const v1 = new Dexie(name);
    v1.version(1).stores({ parts: "id, &partKey, binId, systemId, updatedAt, deletedAt", bins: "id, &binKey, deletedAt", systems: "id, sortOrder", settings: "key", drafts: "key" });
    await v1.table("parts").add({ id: "00000000-0000-4000-8000-000000000001", partKey: "MP-0001", partId: "MP-0001", name: "Legacy", updatedAt: "2026-10-18T00:00:00.000Z", deletedAt: null });
    v1.close();
    const upgraded = new PartsDB(name);
    expect((await syncStatus(upgraded)).pending).toBe(1);
    upgraded.close();
  });
});
