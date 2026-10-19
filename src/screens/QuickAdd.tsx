// First-pass logging as parts come off the old shelves: name, system, qty, disposition.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { quickAdd, suggestPartId } from "../db/repo";
import { DISPOSITIONS, type Disposition } from "../domain/rules";
import { Choice, Field, Stepper, useDraft, useSystems, useToast } from "../ui";

interface Form {
  name: string;
  systemId: string | null;
  qty: number;
  disposition: Disposition | null;
}

const blank = (systemId: string | null = null): Form => ({ name: "", systemId, qty: 1, disposition: "Keep" });

export default function QuickAdd() {
  const systems = useSystems();
  const draft = useDraft<Form>("quick-add", blank());
  const f = draft.value;
  const set = (patch: Partial<Form>) => draft.setValue({ ...f, ...patch });
  const nextId = useLiveQuery(() => suggestPartId(), []);
  const [last, setLast] = useState<{ id: string; partId: string; name: string } | null>(null);
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
      const p = await quickAdd(f);
      setLast({ id: p.id, partId: p.partId, name: p.name });
      draft.reset(blank(f.systemId)); // keep the system for the next part off the same shelf
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
            <span className="saved-name">{last.name}</span>
          </div>
          <Link to={`/parts/${last.id}`} className="btn small">
            Add details
          </Link>
        </div>
      )}

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

      <div className="field">
        <span className="field-label">System</span>
        <Choice
          label="System"
          cols={2}
          allowNone
          value={f.systemId}
          onChange={(systemId) => set({ systemId })}
          options={(systems ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
      </div>

      <div className="field">
        <span className="field-label">Quantity</span>
        <Stepper label="Quantity" value={f.qty} onChange={(qty) => set({ qty })} />
      </div>

      <div className="field">
        <span className="field-label">Disposition</span>
        <Choice label="Disposition" cols={2} value={f.disposition} onChange={(disposition) => set({ disposition })} options={DISPOSITIONS.map((d) => ({ value: d, label: d }))} />
      </div>

      <div className="sticky-actions">
        <button type="submit" className="btn primary big" disabled={saving}>
          Save &amp; next{nextId ? ` · ${nextId}` : ""}
        </button>
      </div>
    </form>
  );
}
