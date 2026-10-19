// Server side of photos: upload bytes once, sync only the small metadata, delete through sync.
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memoryStore.js";
import { MAX_PHOTO_BYTES, handlePhotoGet, handlePhotoUpload } from "./photoHandler.js";
import { HttpError, handleSync } from "./syncHandler.js";

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const meta = (over: Record<string, unknown> = {}) => ({
  id: uuid(),
  partId: "00000000-0000-4000-8000-999999999999",
  mime: "image/jpeg",
  width: 1600,
  height: 1200,
  size: JPEG.length,
  createdAt: "2026-10-19T12:00:00.000Z",
  updatedAt: "2026-10-19T12:00:00.000Z",
  deletedAt: null,
  ...over,
});

describe("photo upload", () => {
  it("stores the image and serves it back exactly", async () => {
    const m = meta();
    expect(await handlePhotoUpload(store, { ...m, data: b64(JPEG) })).toEqual({ ok: true });
    const got = await handlePhotoGet(store, m.id);
    expect(got?.mime).toBe("image/jpeg");
    expect(Buffer.from(got!.bytes).equals(Buffer.from(JPEG))).toBe(true);
  });

  it("accepts the same upload twice (a retry after a dropped connection)", async () => {
    const m = meta();
    await handlePhotoUpload(store, { ...m, data: b64(JPEG) });
    expect(await handlePhotoUpload(store, { ...m, data: b64(JPEG) })).toEqual({ ok: true });
  });

  it("refuses files that aren't really images, oversized files and bad ids", async () => {
    await expect(handlePhotoUpload(store, { ...meta(), data: Buffer.from("<script>alert(1)</script>").toString("base64") })).rejects.toBeInstanceOf(HttpError);
    await expect(handlePhotoUpload(store, { ...meta({ mime: "text/html" }), data: b64(JPEG) })).rejects.toBeInstanceOf(HttpError);
    const huge = new Uint8Array(MAX_PHOTO_BYTES + 1);
    huge.set([0xff, 0xd8, 0xff]);
    await expect(handlePhotoUpload(store, { ...meta(), data: b64(huge) })).rejects.toBeInstanceOf(HttpError);
    await expect(handlePhotoUpload(store, { ...meta({ id: "../../etc" }), data: b64(JPEG) })).rejects.toBeInstanceOf(HttpError);
    await expect(handlePhotoUpload(store, { ...meta(), data: "%%%not base64%%%" })).rejects.toBeInstanceOf(HttpError);
  });

  it("returns nothing for an unknown id", async () => {
    expect(await handlePhotoGet(store, uuid())).toBeNull();
    expect(await handlePhotoGet(store, "not-a-uuid")).toBeNull();
  });
});

describe("photos in sync", () => {
  it("lists uploaded photos to other devices without the image bytes", async () => {
    const m = meta();
    await handlePhotoUpload(store, { ...m, data: b64(JPEG) });
    const res = await handleSync(store, { push: [], cursors: {} });
    expect(res.rows.photos).toHaveLength(1);
    expect(res.rows.photos[0]).toMatchObject({ id: m.id, partId: m.partId, mime: "image/jpeg" });
    expect(JSON.stringify(res.rows.photos[0])).not.toContain("data");
  });

  it("deletes a photo through sync, after which it's no longer served", async () => {
    const m = meta();
    await handlePhotoUpload(store, { ...m, data: b64(JPEG) });
    const del = await handleSync(store, { push: [{ table: "photos", row: { ...m, deletedAt: "2026-10-19T12:05:00.000Z", updatedAt: "2026-10-19T12:05:00.000Z" } }], cursors: {} });
    expect(del.results[0].status).toBe("ok");
    expect(del.rows.photos[0].deletedAt).toBe("2026-10-19T12:05:00.000Z");
    expect(await handlePhotoGet(store, m.id)).toBeNull();
  });

  it("won't create a photo through sync without its image", async () => {
    const res = await handleSync(store, { push: [{ table: "photos", row: meta() }], cursors: {} });
    expect(res.results[0].status).toBe("invalid");
  });
});
