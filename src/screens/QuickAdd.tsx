// First-pass logging as parts come off the old shelves. Optional fields (part number,
// manufacturer, old location) can be switched on per device; system, manufacturer and old
// location carry over to the next part so a whole bin can be logged quickly.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { addPhoto, quickAdd, suggestPartId } from "../db/repo";
import { PhotoPicker, type ShrunkPhoto } from "./Photos";
import { db } from "../db/db";
import { DISPOSITIONS, MANUFACTURERS } from "../domain/rules";
import { blankQuickAdd, nextQuickAddForm, type QuickAddForm } from "../domain/quickAdd";
import { distinctOptions } from "../domain/search";
import { indexSystems } from "../domain/systems";
import { Choice, Field, Stepper, useDraft, useParts, useSystems, useToast } from "../ui";

// Per-device preferences, not synced. Part number starts off; the other two start on.
const FIELD_PREFS = [
  { key: "quickAdd.showPartNumber", label: "Part number", defaultOn: false },
  { key: "quickAdd.showManufacturer", label: "Manufacturer", defaultOn: true },
  { key: "quickAdd.showOldLocation", label: "Old location", defaultOn: true },
] as const;

export default function QuickAdd() {
  const systems = useSystems();
  const parts = useParts();
  const draft = useDraft<QuickAddForm>("quick-add", blankQuickAdd());
  const f = { ...blankQuickAdd(), ...draft.value }; // older drafts may lack newer fields
  const set = (patch: Partial<QuickAddForm>) => draft.setValue({ ...f, ...patch });
  const nextId = useLiveQuery(() => suggestPartId(), []);
  const prefs = useLiveQuery(
    async () => {
      const out: Record<string, boolean> = {};
      for (const p of FIELD_PREFS) {
        const v = (await db.settings.get(p.key))?.value;
        out[p.key] = typeof v === "boolean" ? v : p.defaultOn;
      }
      return out;
    },
    [],
    Object.fromEntries(FIELD_PREFS.map((p) => [p.key, p.defaultOn])),
  );
  const [showPartNo, showMfr, showLoc] = FIELD_PREFS.map((p) => prefs[p.key]);
  // f.systemId holds the sub-system when one is picked, otherwise the main system.
  const idx = useMemo(() => indexSystems(systems ?? []), [systems]);
  const mainId = idx.mainOf(f.systemId);
  const subId = idx.subOf(f.systemId);
  const mainChoices = idx.mains.filter((s) => s.active || s.id === mainId);
  const subChoices = mainId ? idx.subs(mainId).filter((s) => s.active || s.id === subId) : [];
  const mfrSuggestions = [...new Set([...MANUFACTURERS, ...distinctOptions(parts ?? [], "manufacturer").map((o) => o.label)])].sort();
  const locSuggestions = distinctOptions(parts ?? [], "oldLocation").map((o) => o.label);
  const [last, setLast] = useState<{ id: string; partId: string; name: string; detail: string } | null>(null);
  // Photos taken before saving; attached to the part when it's saved. Not kept across reloads.
  const [pendingPhotos, setPendingPhotos] = useState<ShrunkPhoto[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (draft.ready) nameRef.current?.focus();
  }, [draft.ready]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) {
      setError("Enter a part name.");
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const p = await quickAdd({
        ...f,
        mfrPartNumber: showPartNo ? f.mfrPartNumber : "",
        manufacturer: showMfr ? f.manufacturer : "",
        oldLocation: showLoc ? f.oldLocation : "",
      });
      for (const ph of pendingPhotos) await addPhoto(p.id, ph.data, ph.mime, ph.width, ph.height);
      setPendingPhotos([]);
      setLast({ id: p.id, partId: p.partId, name: p.name, detail: [p.manufacturer, p.mfrPartNumber].filter(Boolean).join(" · ") });
      draft.reset(nextQuickAddForm(f)); // system, manufacturer and old location stay for the next part
      setError("");
      toast(`Saved ${p.partId}`);
      nameRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="screen" onSubmit={save} noValidate>
      <header className="screen-head">
        <h1>Quick add</h1>
        <p className="sub">Log it now, fill in details later.</p>
      </header>

      {draft.restored && <div className="notice">Restored the part you were entering.</div>}

      {last && (
        <div className="saved">
          <div>
            <span className="saved-id">{last.partId}</span>
            <span className="saved-name">
              {last.name}
              {last.detail ? ` · ${last.detail}` : ""}
            </span>
          </div>
          <Link to={`/parts/${last.id}`} className="btn small">
            Add details
          </Link>
        </div>
      )}

      {showLoc && (
        <Field label="Old location" hint="Stays set while you work through this bin">
          <input
            id="qa-loc"
            list="qa-locs"
            value={f.oldLocation}
            onChange={(e) => set({ oldLocation: e.target.value })}
            placeholder="e.g. Misc bin 7"
            autoComplete="off"
          />
        </Field>
      )}
      <datalist id="qa-locs">
        {locSuggestions.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      <Field label="Part name" error={error}>
        <input
          ref={nameRef}
          id="qa-name"
          value={f.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="e.g. Raw water pump impeller"
          autoComplete="off"
          enterKeyHint="done"
        />
      </Field>

      {(showMfr || showPartNo) && (
        <div className="grid2">
          {showMfr && (
            <Field label="Manufacturer">
              <input id="qa-mfr" list="qa-mfrs" value={f.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} placeholder="e.g. OMC" autoComplete="off" />
            </Field>
          )}
          {showPartNo && (
            <Field label="Part number">
              <input
                id="qa-partno"
                value={f.mfrPartNumber}
                onChange={(e) => set({ mfrPartNumber: e.target.value })}
                placeholder="e.g. 0388xxx"
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
          )}
        </div>
      )}
      <datalist id="qa-mfrs">
        {mfrSuggestions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <div className="field">
        <div className="row-between">
          <span className="field-label">System</span>
          <Link to="/systems" className="small-link">
            Edit systems
          </Link>
        </div>
        <Choice
          label="System"
          cols={2}
          allowNone
          value={mainId}
          onChange={(systemId) => set({ systemId })}
          options={mainChoices.map((s) => ({ value: s.id, label: s.name }))}
        />
      </div>

      {subChoices.length > 0 && (
        <div className="field">
          <span className="field-label">Sub-system</span>
          <Choice
            label="Sub-system"
            cols={2}
            allowNone
            value={subId}
            onChange={(sub) => set({ systemId: sub ?? mainId })}
            options={subChoices.map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
      )}

      <div className="field">
        <span className="field-label">Photos</span>
        <div className="row-gap">
          <PhotoPicker label={pendingPhotos.length ? "Add another photo" : "Take photo"} onPicked={(list) => setPendingPhotos((cur) => [...cur, ...list])} />
          {pendingPhotos.length > 0 && (
            <>
              <span className="chip info">
                {pendingPhotos.length} photo{pendingPhotos.length === 1 ? "" : "s"} ready
              </span>
              <button type="button" className="btn small" onClick={() => setPendingPhotos([])}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Quantity</span>
        <Stepper label="Quantity" value={f.qty} onChange={(qty) => set({ qty })} />
      </div>

      <div className="field">
        <span className="field-label">Disposition</span>
        <Choice label="Disposition" cols={2} value={f.disposition} onChange={(disposition) => set({ disposition })} options={DISPOSITIONS.map((d) => ({ value: d, label: d }))} />
        <small className="hint">Not sure yet? Pick Unknown and decide on a later pass.</small>
      </div>

      <fieldset className="field-prefs">
        <legend>Show in Quick add</legend>
        {FIELD_PREFS.map((p) => (
          <label key={p.key} className="check">
            <input type="checkbox" checked={prefs[p.key]} onChange={(e) => void db.settings.put({ key: p.key, value: e.target.checked })} />
            {p.label}
          </label>
        ))}
      </fieldset>

      <div className="sticky-actions">
        <button type="submit" className="btn primary big" disabled={saving}>
          Save &amp; next{nextId ? ` · ${nextId}` : ""}
        </button>
      </div>
    </form>
  );
}
