// GET /api/photo?id=<uuid>  -> the image (signed in only)
// POST /api/photo            -> upload one photo { id, partId, mime, width, height, createdAt, updatedAt, data: base64 }
import { getStore, isSignedIn, readJson, route, send } from "../server/http.js";
import { handlePhotoGet, handlePhotoUpload } from "../server/photoHandler.js";
import { HttpError } from "../server/syncHandler.js";

export default route(["GET", "POST"], async (req, res) => {
  if (!isSignedIn(req)) throw new HttpError(401, "Sign in to see photos.");
  if (req.method === "POST") return send(res, 200, await handlePhotoUpload(getStore(), await readJson(req)));

  const id = new URL(req.url ?? "", "http://x").searchParams.get("id");
  const photo = await handlePhotoGet(getStore(), id);
  if (!photo) throw new HttpError(404, "Photo not found.");
  res.statusCode = 200;
  res.setHeader("Content-Type", photo.mime);
  res.setHeader("Content-Length", String(photo.bytes.length));
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable"); // a photo id never changes its image
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.end(Buffer.from(photo.bytes));
});
