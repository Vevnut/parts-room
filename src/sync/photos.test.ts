// Photos between two devices: taken on the phone, uploaded once, listed on the computer,
// downloaded only when viewed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PartsDB } from "../db/db";
import { addPhoto, deletePhoto, ensureSeeded, quickAdd, withDatabase } from "../db/repo";
import { MemoryStore } from "../../server/memoryStore";
import { handleSync } from "../../server/syncHandler";
import { handlePhotoGet, handlePhotoUpload } from "../../server/photoHandler";
import { syncOnce, syncStatus, type Remote } from "./engine";
import { fetchPhotoData, scaleToFit, toBase64 } from "./photos";

let store: MemoryStore;
let A: PartsDB;
let B: PartsDB;
const wire = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]);
const buf = () => JPEG.slice().buffer;

function remote(): Remote & { uploads: number } {
  const r = {
    uploads: 0,
    sync: async (body: unknown) => wire(await handleSync(store, wire(body))),
    uploadPhoto: async (body: unknown) => {
      r.uploads++;
      await handlePhotoUpload(store, wire(body));
    },
  };
  return r as Remote & { uploads: number };
}
const getPhoto = async (id: string) => {
  const p = await handlePhotoGet(store, id);
  return p ? new Uint8Array(p.bytes).buffer : null;
};

beforeEach(async () => {
  store = new MemoryStore();
  for (const d of [A, B]) if (d) await d.delete();
  A = new PartsDB("photo-a");
  B = new PartsDB("photo-b");
  await withDatabase(A, ensureSeeded);
  await withDatabase(B, ensureSeeded);
});

const partOnA = () => withDatabase(A, () => quickAdd({ name: "Points set", systemId: null, qty: 1, disposition: "Unknown" }));

describe("photos", () => {
  it("keeps a new photo on the device until it uploads, then lists it on the other device", async () => {
    const p = await partOnA();
    const photo = await withDatabase(A, () => addPhoto(p.id, buf(), "image/jpeg", 1600, 1200));
    expect((await syncStatus(A)).photosPending).toBe(1);

    const r = remote();
    await syncOnce(r, A);
    expect(r.uploads).toBe(1);
    expect((await A.photos.get(photo.id))!.uploaded).toBe(1);
    expect((await syncStatus(A)).photosPending).toBe(0);

    await syncOnce(remote(), B);
    const onB = (await B.photos.get(photo.id))!;
    expect(onB).toMatchObject({ partId: p.id, mime: "image/jpeg", uploaded: 1 });
    expect(onB.data).toBeNull(); // not downloaded until viewed
  });

  it("downloads a photo when viewed and keeps it for offline use", async () => {
    const p = await partOnA();
    const photo = await withDatabase(A, () => addPhoto(p.id, buf(), "image/jpeg", 800, 600));
    await syncOnce(remote(), A);
    await syncOnce(remote(), B);
    const getter = vi.fn(getPhoto);
    const data = await fetchPhotoData(B, photo.id, getter);
    expect(new Uint8Array(data!)).toEqual(JPEG);
    await fetchPhotoData(B, photo.id, getter);
    expect(getter).toHaveBeenCalledTimes(1); // second view came from the device
  });

  it("never uploads a photo deleted before it was sent", async () => {
    const p = await partOnA();
    const photo = await withDatabase(A, () => addPhoto(p.id, buf(), "image/jpeg", 800, 600));
    await withDatabase(A, () => deletePhoto(photo.id));
    const r = remote();
    await syncOnce(r, A);
    expect(r.uploads).toBe(0);
    expect(await A.photos.get(photo.id)).toBeUndefined();
  });

  it("removes a deleted photo everywhere, without sending the image again", async () => {
    const p = await partOnA();
    const photo = await withDatabase(A, () => addPhoto(p.id, buf(), "image/jpeg", 800, 600));
    await syncOnce(remote(), A);
    await syncOnce(remote(), B);
    await withDatabase(A, () => deletePhoto(photo.id));
    const r = remote();
    const spy = vi.spyOn(r, "sync");
    await syncOnce(r, A);
    expect(JSON.stringify(spy.mock.calls[0][0])).not.toContain(toBase64(buf()));
    await syncOnce(remote(), B);
    expect((await B.photos.get(photo.id))!.deletedAt).toBeTruthy();
    expect(await getPhoto(photo.id)).toBeNull();
  });
});

describe("helpers", () => {
  it("scales big photos down to fit, keeping the shape, and leaves small ones alone", () => {
    expect(scaleToFit(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(scaleToFit(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(scaleToFit(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it("base64-encodes image bytes", () => {
    expect(toBase64(new Uint8Array([0xff, 0xd8, 0xff]).buffer)).toBe("/9j/");
  });
});
