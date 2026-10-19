// Photo helpers: shrink a camera photo before storing it, encode it for upload, and fetch an
// image this device doesn't have yet (then keep it for offline viewing).
import type { PartsDB } from "../db/db";

export const MAX_EDGE = 1600; // px on the long side: plenty to read a part number or tag
const QUALITY = 0.82;

export function scaleToFit(width: number, height: number, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Browser only: decode, shrink and re-encode as JPEG (also drops EXIF, including any GPS location).
export async function shrinkPhoto(file: Blob): Promise<{ data: ArrayBuffer; width: number; height: number; mime: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const { width, height } = scaleToFit(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that photo."))), "image/jpeg", QUALITY));
  return { data: await blob.arrayBuffer(), width, height, mime: "image/jpeg" };
}

// The image for a photo: from this device if it has it, otherwise downloaded once and kept.
export async function fetchPhotoData(database: PartsDB, id: string, download: (id: string) => Promise<ArrayBuffer | null>): Promise<ArrayBuffer | null> {
  const row = await database.photos.get(id);
  if (!row || row.deletedAt) return null;
  if (row.data) return row.data;
  const data = await download(id);
  if (data) await database.photos.update(id, { data });
  return data;
}
