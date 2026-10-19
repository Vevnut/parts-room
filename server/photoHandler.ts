// Photo upload (once per photo) and download. Only real JPEG/PNG/WebP images of a modest
// size are accepted, checked by their first bytes rather than trusting the stated type.
import { PHOTO_MIMES, sanitize } from "./fields.js";
import { HttpError } from "./syncHandler.js";
import type { Store, StoredPhoto } from "./store.js";

export const MAX_PHOTO_BYTES = 1_500_000; // the app sends ~150-400 KB after shrinking
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function looksLike(mime: string, b: Uint8Array): boolean {
  if (mime === "image/jpeg") return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === "image/png") return b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x);
  if (mime === "image/webp")
    return b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  return false;
}

export async function handlePhotoUpload(store: Store, body: unknown): Promise<{ ok: true }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Expected a JSON object.");
  const { data, ...meta } = body as Record<string, unknown>;
  if (typeof data !== "string" || !data || data.length > Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 4) throw new HttpError(413, "That photo is too large.");
  if (!BASE64.test(data)) throw new HttpError(400, "The photo data is damaged.");
  if (!(PHOTO_MIMES as readonly unknown[]).includes(meta.mime)) throw new HttpError(415, "Only JPEG, PNG or WebP photos.");
  const bytes = new Uint8Array(Buffer.from(data, "base64"));
  if (bytes.length > MAX_PHOTO_BYTES) throw new HttpError(413, "That photo is too large.");
  if (!looksLike(String(meta.mime), bytes)) throw new HttpError(415, "That file isn't a photo.");
  const s = sanitize("photos", { ...meta, size: bytes.length, deletedAt: null });
  if ("reason" in s) throw new HttpError(400, s.reason);
  await store.insertPhoto(s.row, bytes);
  return { ok: true };
}

export async function handlePhotoGet(store: Store, id: unknown): Promise<StoredPhoto | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  return store.getPhoto(id);
}
