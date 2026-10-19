// Photos on a part: take or pick photos, see them as thumbnails, tap to view large or delete.
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { addPhoto, deletePhoto } from "../db/repo";
import { downloadPhoto } from "../sync/client";
import { fetchPhotoData, shrinkPhoto } from "../sync/photos";
import type { PhotoMeta } from "../domain/rules";
import { ConfirmButton, useToast } from "../ui";

// Shows one photo, from this device or downloaded on demand.
export function PhotoImg({ photo, className, alt }: { photo: PhotoMeta; className?: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    fetchPhotoData(db, photo.id, downloadPhoto)
      .then((data) => {
        if (!live) return;
        if (!data) return setFailed(true);
        made = URL.createObjectURL(new Blob([data], { type: photo.mime }));
        setUrl(made);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [photo.id, photo.mime]);
  if (url) return <img src={url} alt={alt} className={className} />;
  return <div className={`${className ?? ""} photo-missing`}>{failed ? "Not on this device yet. Sync to load it." : "Loading…"}</div>;
}

export type ShrunkPhoto = Awaited<ReturnType<typeof shrinkPhoto>>;

// Camera / file picker that hands back shrunken photos.
export function PhotoPicker({ onPicked, label = "Take photo" }: { onPicked: (photos: ShrunkPhoto[]) => void | Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function change(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    try {
      const out: ShrunkPhoto[] = [];
      for (const f of files) out.push(await shrinkPhoto(f));
      await onPicked(out);
    } catch (err) {
      toast((err as Error).message || "Couldn't add that photo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className={`btn file-btn${busy ? " busy" : ""}`}>
      {busy ? "Processing…" : label}
      <input type="file" accept="image/*" capture="environment" multiple onChange={change} disabled={busy} />
    </label>
  );
}

export function PartPhotos({ partId, partLabel }: { partId: string; partLabel: string }) {
  const photos = useLiveQuery(
    async () => (await db.photos.where("partId").equals(partId).filter((p) => !p.deletedAt).toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [partId],
  );
  const [open, setOpen] = useState<PhotoMeta | null>(null);
  const toast = useToast();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="stack">
      {photos && photos.length > 0 && (
        <div className="photo-grid">
          {photos.map((p, i) => (
            <button type="button" key={p.id} className="photo-thumb" onClick={() => setOpen(p)} aria-label={`Photo ${i + 1} of ${partLabel}`}>
              <PhotoImg photo={p} alt="" className="photo-img" />
            </button>
          ))}
        </div>
      )}
      <PhotoPicker
        label={photos?.length ? "Add another photo" : "Take photo"}
        onPicked={async (list) => {
          for (const ph of list) await addPhoto(partId, ph.data, ph.mime, ph.width, ph.height);
          toast(list.length === 1 ? "Photo added" : `${list.length} photos added`);
        }}
      />

      {open && (
        <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={`Photo of ${partLabel}`} onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
          <PhotoImg photo={open} alt={`Photo of ${partLabel}`} className="photo-full" />
          <div className="actions-row photo-actions">
            <ConfirmButton
              className="btn danger"
              confirmText="Tap again to delete"
              onConfirm={async () => {
                await deletePhoto(open.id);
                setOpen(null);
                toast("Photo deleted");
              }}
            >
              Delete photo
            </ConfirmButton>
            <button ref={closeRef} type="button" className="btn" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
