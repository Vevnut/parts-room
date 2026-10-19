// Edit the System list: add, rename, reorder, hide. Hidden systems drop out of the pickers
// but parts already filed under them keep it.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addSystem, moveSystem, renameSystem, setSystemActive } from "../db/repo";
import type { System } from "../domain/rules";
import { Field, useParts, useSystems, useToast } from "../ui";

function SystemRow({ s, count, first, last }: { s: System; count: number; first: boolean; last: boolean }) {
  const [name, setName] = useState(s.name);
  const [error, setError] = useState("");
  const toast = useToast();
  useEffect(() => {
    setName(s.name);
  }, [s.name]);
  const dirty = name.trim().replace(/\s+/g, " ") !== s.name;

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (!dirty) return;
    try {
      await renameSystem(s.id, name);
      setError("");
      toast(`Renamed to ${name.trim()}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <li className={`system-row${s.active ? "" : " hidden-system"}`}>
      <form onSubmit={save} className="system-name">
        <input aria-label={`Name of ${s.name}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void save()} enterKeyHint="done" />
        {error && <small className="error">{error}</small>}
        <small className="hint">
          {count} part{count === 1 ? "" : "s"}
          {s.active ? "" : " · hidden from pickers"}
        </small>
      </form>
      <div className="system-actions">
        {s.active && (
          <>
            <button type="button" className="btn small" aria-label={`Move ${s.name} up`} disabled={first} onClick={() => moveSystem(s.id, -1)}>
              ↑
            </button>
            <button type="button" className="btn small" aria-label={`Move ${s.name} down`} disabled={last} onClick={() => moveSystem(s.id, 1)}>
              ↓
            </button>
          </>
        )}
        <button type="button" className="btn small" onClick={() => setSystemActive(s.id, !s.active)}>
          {s.active ? "Hide" : "Show"}
        </button>
      </div>
    </li>
  );
}

export default function Systems() {
  const systems = useSystems();
  const parts = useParts();
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of parts ?? []) if (p.systemId) m.set(p.systemId, (m.get(p.systemId) ?? 0) + 1);
    return m;
  }, [parts]);
  const active = (systems ?? []).filter((s) => s.active);
  const hidden = (systems ?? []).filter((s) => !s.active);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      const s = await addSystem(newName);
      setNewName("");
      setError("");
      toast(`Added ${s.name}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Systems</h1>
        <p className="sub">The categories you file parts under. Renaming keeps every part attached. Hide one you don't use; parts already under it keep it.</p>
      </header>

      <form className="card stack" onSubmit={add} noValidate>
        <Field label="New system" error={error}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Trailer & Towing" autoComplete="off" />
        </Field>
        <button type="submit" className="btn primary" disabled={!newName.trim()}>
          Add system
        </button>
      </form>

      <ul className="list">
        {active.map((s, i) => (
          <SystemRow key={s.id} s={s} count={counts.get(s.id) ?? 0} first={i === 0} last={i === active.length - 1} />
        ))}
      </ul>

      {hidden.length > 0 && (
        <section className="stack">
          <h2>Hidden</h2>
          <ul className="list">
            {hidden.map((s) => (
              <SystemRow key={s.id} s={s} count={counts.get(s.id) ?? 0} first last />
            ))}
          </ul>
        </section>
      )}

      <Link to="/add" className="btn">
        Back to Quick add
      </Link>
    </div>
  );
}
