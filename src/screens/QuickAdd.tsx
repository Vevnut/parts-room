// First-pass logging as parts come off the old shelves. The settings that stay the same for a
// whole bin (system, sub-system, old location, container spot) sit in one card that folds away
// once set; the part's own fields follow the part editor's order, part number first.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { addPhoto, adjustQty, quickAdd, suggestPartId } from "../db/repo";
import { PhotoPicker, type ShrunkPhoto } from "./Photos";
import { ScanButton, UPC_NOTE } from "./Scanner";
import { DISPOSITIONS, MANUFACTURERS, type Part } from "../domain/rules";
import { blankQuickAdd, nextQuickAddForm, type QuickAddForm } from "../domain/quickAdd";
import { distinctOptions, samePartNumber } from "../domain/search";
import { indexSystems } from "../domain/systems";
import { Choice, Field, Stepper, fmtQty, useDraft, useParts, useSystems, useToast } from "../ui";

export default function QuickAdd() {
  const systems = useSystems();
  const parts = useParts();
  const draft = useDraft<QuickAddForm>("quick-add", blankQuickAdd());
  const f = { ...blankQuickAdd(), ...draft.value }; // older drafts may lack newer fields
  const set = (patch: Partial<QuickAddForm>) => draft.setValue({ ...f, ...patch });
  const nextId = useLiveQuery(() => suggestPartId(), []);
  // f.systemId holds the sub-system when one is picked, otherwise the main system.
  const idx = useMemo(() => indexSystems(systems ?? []), [systems]);
  const mainId = idx.mainOf(f.systemId);
  const subId = idx.subOf(f.systemId);
  const mainChoices = idx.mains.filter((s) => s.active || s.id === mainId);
  const subChoices = mainId ? idx.subs(mainId).filter((s) => s.active || s.id === subId) : [];
  const matches = useMemo(() => samePartNumber(parts ?? [], f.mfrPartNumber), [parts, f.mfrPartNumber]);
  const mfrSuggestions = [...new Set([...MANUFACTURERS, ...distinctOptions(parts ?? [], "manufacturer").map((o) => o.label)])].sort();
  const locSuggestions = distinctOptions(parts ?? [], "oldLocation").map((o) => o.label);
  const spotSuggestions = distinctOptions(parts ?? [], "stagingSpot").map((o) => o.label);
  const [last, setLast] = useState<{ id: string; partId: string; name: string; detail: string } | null>(null);
  // Photos taken before saving; attached to the part when it's saved. Not kept across reloads.
  const [pendingPhotos, setPendingPhotos] = useState<ShrunkPhoto[]>([]);
  const [error, setError] = useState("");
  const [scanNote, setScanNote] = useState(""); // set when a scan looks like a UPC rather than a part number
  const [saving, setSaving] = useState(false);
  const partNoRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  // The bin settings card starts open until something in it is set, then folds to a one-line summary.
  const from = f.oldLocation.trim();
  const to = f.stagingSpot.trim();
  const route = from && to ? `${from} → ${to}` : from ? `from ${from}` : to ? `to ${to}` : "";
  const batch = [f.systemId ? idx.label(f.systemId) : "", route].filter(Boolean);
  const [batchOpen, setBatchOpen] = useState<boolean | null>(null);
  const showBatch = batchOpen ?? batch.length === 0;

  useEffect(() => {
    if (!draft.ready) return;
    setBatchOpen((cur) => cur ?? batch.length === 0); // decide once, so it doesn't fold while it's being filled in
    partNoRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.ready]);

  function done(msg: string) {
    setPendingPhotos([]);
    draft.reset(nextQuickAddForm(f)); // system, manufacturer, old location and container spot stay for the next part
    setScanNote("");
    setError("");
    toast(msg);
    partNoRef.current?.focus();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) {
      setError("Enter a part name.");
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const p = await quickAdd(f);
      for (const ph of pendingPhotos) await addPhoto(p.id, ph.data, ph.mime, ph.width, ph.height);
      setLast({ id: p.id, partId: p.partId, name: p.name, detail: [p.manufacturer, p.mfrPartNumber, `qty ${fmtQty(p.qty)}`].filter(Boolean).join(" · ") });
      done(`Saved ${p.partId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Adds this count (and any photos) to a part already logged under the same number.
  async function addTo(p: Part) {
    setSaving(true);
    try {
      const qty = await adjustQty(p.id, f.qty);
      for (const ph of pendingPhotos) await addPhoto(p.id, ph.data, ph.mime, ph.width, ph.height);
      setLast({ id: p.id, partId: p.partId, name: p.name, detail: `added ${fmtQty(f.qty)}, now ${fmtQty(qty)}` });
      done(`Added ${fmtQty(f.qty)} to ${p.partId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="screen qa" onSubmit={save} noValidate>
      <header className="qa-head">
        <h1>Add part</h1>
        {nextId && <span className="qa-next mono">{nextId}</span>}
      </header>

      {draft.restored && <div className="notice">Restored the part you were entering.</div>}

      {last && (
        <div className="saved qa-saved">
          <span className="qa-saved-text">
            <b className="mono">{last.partId}</b> {last.name}
            {last.detail ? <small> · {last.detail}</small> : null}
          </span>
          <Link to={`/parts/${last.id}`} className="btn small">
            Details
          </Link>
        </div>
      )}

      <section className={`qa-batch${showBatch ? " open" : ""}`}>
        <button type="button" className="qa-batch-head" aria-expanded={showBatch} onClick={() => setBatchOpen(!showBatch)}>
          <span className="qa-batch-title">This bin</span>
          <span className="qa-batch-sum">{batch.length ? batch.join(" · ") : "System and locations"}</span>
          <span className="qa-batch-toggle">{showBatch ? "Done" : "Change"}</span>
        </button>
        {showBatch && (
          <div className="qa-batch-body">
            <div className="grid2">
              <Field label="System">
                <select value={mainId ?? ""} onChange={(e) => set({ systemId: e.target.value || null })}>
                  <option value="">None</option>
                  {mainChoices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sub-system">
                <select value={subId ?? ""} disabled={!subChoices.length} onChange={(e) => set({ systemId: e.target.value || mainId })}>
                  <option value="">{subChoices.length ? "None" : "—"}</option>
                  {subChoices.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Old location">
                <input list="qa-locs" value={f.oldLocation} onChange={(e) => set({ oldLocation: e.target.value })} placeholder="Misc bin 7" autoComplete="off" />
              </Field>
              <Field label="Container spot">
                <input list="qa-spots" value={f.stagingSpot} onChange={(e) => set({ stagingSpot: e.target.value })} placeholder="Container A" autoComplete="off" />
              </Field>
            </div>
            <small className="hint">
              These stay set from part to part. <Link to="/systems">Edit systems</Link>
            </small>
          </div>
        )}
      </section>
      <datalist id="qa-locs">
        {locSuggestions.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <datalist id="qa-spots">
        {spotSuggestions.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      <Field label="Part number" hint={scanNote || undefined}>
        <span className="input-with-btn">
          <input
            ref={partNoRef}
            value={f.mfrPartNumber}
            onChange={(e) => {
              setScanNote("");
              set({ mfrPartNumber: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                nameRef.current?.focus();
              }
            }}
            placeholder="e.g. 47-43026Q06"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
          />
          <ScanButton
            onScan={(r) => {
              set({ mfrPartNumber: r.value });
              setScanNote(r.upc ? UPC_NOTE : "");
              toast(`Scanned ${r.value}`);
              nameRef.current?.focus();
            }}
          />
        </span>
      </Field>

      {matches.length > 0 && (
        <div className="notice dup" role="status">
          <b>Already logged under this number:</b>
          <ul className="dup-list">
            {matches.slice(0, 3).map((p) => (
              <li key={p.id}>
                <span>
                  <span className="mono">{p.partId}</span> {p.name} · qty {fmtQty(p.qty)}
                  {p.systemId ? ` · ${idx.label(p.systemId)}` : ""}
                  {p.stagingSpot ? ` · in ${p.stagingSpot}` : ""}
                </span>
                <span className="actions-row">
                  <button type="button" className="btn small primary" disabled={saving} onClick={() => void addTo(p)}>
                    Add {fmtQty(f.qty)} to {p.partId}
                  </button>
                  <Link to={`/parts/${p.id}`} className="btn small">
                    Open
                  </Link>
                </span>
              </li>
            ))}
          </ul>
          <small className="hint">Different lot or condition? Save it as its own part.</small>
        </div>
      )}

      <Field label="Part name" error={error}>
        <input ref={nameRef} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Water pump impeller" autoComplete="off" enterKeyHint="done" />
      </Field>

      <Field label="Description">
        <textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional: condition, fits, what's in the box" />
      </Field>

      <Field label="Manufacturer" hint="Stays set for the next part">
        <input list="qa-mfrs" value={f.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} placeholder="e.g. Mercury" autoComplete="off" />
      </Field>
      <datalist id="qa-mfrs">
        {mfrSuggestions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <div className="field">
        <span className="field-label">Quantity</span>
        <Stepper label="Quantity" value={f.qty} onChange={(qty) => set({ qty })} />
      </div>

      <div className="field">
        <span className="field-label">Disposition</span>
        <Choice label="Disposition" cols={4} value={f.disposition} onChange={(disposition) => set({ disposition })} options={DISPOSITIONS.map((d) => ({ value: d, label: d }))} />
      </div>

      <div className="qa-photos">
        <PhotoPicker label={pendingPhotos.length ? "Add photo" : "Take photo"} onPicked={(list) => setPendingPhotos((cur) => [...cur, ...list])} />
        {pendingPhotos.length > 0 && (
          <>
            <span className="chip info">
              {pendingPhotos.length} photo{pendingPhotos.length === 1 ? "" : "s"}
            </span>
            <button type="button" className="btn small" onClick={() => setPendingPhotos([])}>
              Clear
            </button>
          </>
        )}
      </div>

      <div className="sticky-actions">
        <button type="submit" className="btn primary big" disabled={saving}>
          Save &amp; next
        </button>
      </div>
    </form>
  );
}
