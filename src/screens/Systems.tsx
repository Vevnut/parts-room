// Edit the system index: main systems, each with optional sub-systems. Add, rename, reorder,
// hide. Hidden systems drop out of the pickers but parts already filed under them keep it.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addSystem, moveSystem, renameSystem, setSystemActive } from "../db/repo";
import type { System } from "../domain/rules";
import { indexSystems } from "../domain/systems";
import { Field, useParts, useSystems, useToast } from "../ui";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function SystemRow({ s, hint, first, last, children }: { s: System; hint: string; first: boolean; last: boolean; children?: React.ReactNode }) {
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
    <div className={`system-row${s.active ? "" : " hidden-system"}`}>
      <form onSubmit={save} className="system-name">
        <input aria-label={`Name of ${s.name}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void save()} enterKeyHint="done" />
        {error && <small className="error">{error}</small>}
        <small className="hint">
          {hint}
          {s.active ? "" : " · hidden from pickers"}
        </small>
      </form>
      <div className="system-actions">
        {children}
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
    </div>
  );
}

function AddSystemForm({ parentId, label, placeholder }: { parentId: string | null; label: string; placeholder: string }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      const s = await addSystem(name, parentId);
      setName("");
      setError("");
      toast(`Added ${s.name}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="stack" onSubmit={add} noValidate>
      <Field label={label} error={error}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} autoComplete="off" />
      </Field>
      <button type="submit" className="btn primary" disabled={!name.trim()}>
        Add
      </button>
    </form>
  );
}

function MainSystem({ s, subs, counts, first, last }: { s: System; subs: System[]; counts: Map<string, number>; first: boolean; last: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = subs.filter((x) => x.active);
  const hiddenSubs = subs.filter((x) => !x.active);
  const total = (counts.get(s.id) ?? 0) + subs.reduce((t, x) => t + (counts.get(x.id) ?? 0), 0);
  const hint = [plural(total, "part"), subs.length ? plural(subs.length, "sub-system") : ""].filter(Boolean).join(" · ");

  return (
    <li className="system-group">
      <SystemRow s={s} hint={hint} first={first} last={last}>
        <button type="button" className="btn small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close" : subs.length ? "Subs" : "+ Sub"}
        </button>
      </SystemRow>
      {open && (
        <div className="subsystems">
          {subs.length > 0 && (
            <ul className="list">
              {[...shown, ...hiddenSubs].map((x) => (
                <li key={x.id}>
                  <SystemRow
                    s={x}
                    hint={plural(counts.get(x.id) ?? 0, "part")}
                    first={x.id === shown[0]?.id}
                    last={x.id === shown[shown.length - 1]?.id}
                  />
                </li>
              ))}
            </ul>
          )}
          <AddSystemForm parentId={s.id} label={`New sub-system in ${s.name}`} placeholder="e.g. Water pumps & impellers" />
        </div>
      )}
    </li>
  );
}

export default function Systems() {
  const systems = useSystems();
  const parts = useParts();
  const idx = useMemo(() => indexSystems(systems ?? []), [systems]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of parts ?? []) if (p.systemId) m.set(p.systemId, (m.get(p.systemId) ?? 0) + 1);
    return m;
  }, [parts]);
  const active = idx.mains.filter((s) => s.active);
  const hidden = idx.mains.filter((s) => !s.active);

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Systems</h1>
        <p className="sub">
          The index you file parts under: main systems, each with optional sub-systems (tap Sub). Renaming keeps every part attached. Hide one you don't use;
          parts already under it keep it.
        </p>
      </header>

      <div className="card">
        <AddSystemForm parentId={null} label="New main system" placeholder="e.g. SUZUKI (M05)" />
      </div>

      <ul className="list">
        {active.map((s, i) => (
          <MainSystem key={s.id} s={s} subs={idx.subs(s.id)} counts={counts} first={i === 0} last={i === active.length - 1} />
        ))}
      </ul>

      {hidden.length > 0 && (
        <section className="stack">
          <h2>Hidden</h2>
          <ul className="list">
            {hidden.map((s) => (
              <MainSystem key={s.id} s={s} subs={idx.subs(s.id)} counts={counts} first last />
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
