// Bins (plus the old-room "old bins"), the bin page a QR label will open, and the two move-back queues.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { assignBin, deleteBin, putAwayBin, saveBin, setMovedBack } from "../db/repo";
import { binStats, placementOf, type Bin } from "../domain/rules";
import { oldBins } from "../domain/search";
import { indexSystems } from "../domain/systems";
import { BinLabel, Choice, ConfirmButton, Field, StatusChip, fmtMoney, fmtQty, useBins, useParts, useSystems, useToast } from "../ui";

export function BinsList() {
  const bins = useBins();
  const parts = useParts();
  const old = useMemo(() => oldBins(parts ?? []), [parts]);
  return (
    <div className="screen">
      <header className="screen-head row-between">
        <h1>Bins</h1>
        <Link to="/bins/new" className="btn primary">
          Add bin
        </Link>
      </header>
      {bins && bins.length === 0 && (
        <div className="empty">
          <strong>No bins yet</strong>
          Add one for each labeled bin or shelf spot, like A1-01, A1-02, B1-01.
        </div>
      )}
      <ul className="list">
        {bins?.map((b) => {
          const s = binStats(b.id, parts ?? []);
          return (
            <li key={b.id}>
              <Link to={`/b/${encodeURIComponent(b.binCode)}`} className="part-row" data-ctx={`bin:${b.id}`}>
                <div className="part-main">
                  <span className="row-gap">
                    <BinLabel code={b.binCode} />
                    {s.done && <span className="chip ok">All put away</span>}
                  </span>
                  <span className="part-meta">{[b.shelfZone, b.binSize, b.labelText].filter(Boolean).join(" · ") || "No details"}</span>
                </div>
                <div className="part-side stats-mini">
                  <span>
                    <b>{s.parts}</b> parts
                  </span>
                  <span>
                    <b>{fmtQty(s.units)}</b> units
                  </span>
                  {s.notPutAway > 0 && (
                    <span className="warn-text">
                      <b>{s.notPutAway}</b> to put away
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {old.length > 0 && (
        <section className="stack">
          <h2>Old bins</h2>
          <p className="sub">Where parts came from, from the Old location on each part. Tap one to see its parts.</p>
          <ul className="list">
            {old.map((o) => (
              <li key={o.value}>
                <Link to={`/parts?loc=${encodeURIComponent(o.value)}`} className="part-row">
                  <div className="part-main">
                    <span className="part-name">{o.label}</span>
                    <span className="part-meta">
                      {o.retail > 0 ? `${fmtMoney(o.retail)} at retail` : "No prices yet"}
                      {o.retail > 0 && o.unpriced > 0 ? ` · ${o.unpriced} without a price` : ""}
                    </span>
                  </div>
                  <div className="part-side stats-mini">
                    <span>
                      <b>{o.parts}</b> parts
                    </span>
                    <span>
                      <b>{fmtQty(o.units)}</b> units
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const SIZES = ["Small", "Medium", "Large", "Shelf"] as const;

export function BinEdit() {
  const { id = "new" } = useParams();
  const [params] = useSearchParams();
  const bin = useLiveQuery(async () => (id === "new" ? null : ((await db.bins.get(id)) ?? null)), [id]);
  if (bin === undefined) return <div className="screen">Loading…</div>;
  return <BinForm key={id} bin={bin} presetCode={params.get("code") ?? ""} />;
}

function BinForm({ bin, presetCode }: { bin: Bin | null; presetCode: string }) {
  const [f, setF] = useState({
    binCode: bin?.binCode ?? presetCode,
    shelfZone: bin?.shelfZone ?? "",
    binSize: bin?.binSize ?? "",
    labelText: bin?.labelText ?? "",
  });
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const toast = useToast();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      const saved = await saveBin({ ...(bin ?? {}), ...f });
      toast(`Saved bin ${saved.binCode}`);
      navigate(`/b/${encodeURIComponent(saved.binCode)}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function remove() {
    if (!bin) return;
    try {
      await deleteBin(bin.id);
      toast(`Deleted bin ${bin.binCode}`);
      navigate("/bins", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="screen" onSubmit={save} noValidate>
      <header className="screen-head">
        <h1>{bin ? `Edit ${bin.binCode}` : "Add bin"}</h1>
      </header>
      <Field label="Bin ID" error={error} hint="What's on the bin, e.g. A1-01">
        <input value={f.binCode} onChange={(e) => setF({ ...f, binCode: e.target.value })} autoCapitalize="characters" autoComplete="off" autoFocus={!bin} />
      </Field>
      <Field label="Shelf / zone">
        <input value={f.shelfZone} onChange={(e) => setF({ ...f, shelfZone: e.target.value })} placeholder="e.g. Shelf A, level 1" />
      </Field>
      <div className="field">
        <span className="field-label">Bin size</span>
        <Choice label="Bin size" cols={4} allowNone value={(SIZES as readonly string[]).includes(f.binSize) ? f.binSize : null} onChange={(v) => setF({ ...f, binSize: v ?? "" })} options={SIZES.map((s) => ({ value: s, label: s }))} />
      </div>
      <Field label="Label text" hint="Printed on the bin label">
        <input value={f.labelText} onChange={(e) => setF({ ...f, labelText: e.target.value })} placeholder="e.g. Impellers & pump parts" />
      </Field>
      <div className="sticky-actions">
        {bin && (
          <ConfirmButton className="btn danger" confirmText="Tap again to delete" onConfirm={remove}>
            Delete
          </ConfirmButton>
        )}
        <button type="button" className="btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Save bin
        </button>
      </div>
    </form>
  );
}

// /b/:code is what a bin's QR label opens.
export function BinDetail() {
  const { code = "" } = useParams();
  const binCode = decodeURIComponent(code).trim().toUpperCase();
  const bin = useLiveQuery(async () => (await db.bins.where("binKey").equals(binCode).first()) ?? null, [binCode]);
  const parts = useParts();
  const toast = useToast();
  const [error, setError] = useState("");

  if (bin === undefined || !parts) return <div className="screen">Loading…</div>;
  if (!bin)
    return (
      <div className="screen">
        <div className="empty">
          <strong>Bin {binCode} not found</strong>
          <Link to={`/bins/new?code=${encodeURIComponent(binCode)}`} className="btn primary">
            Create bin {binCode}
          </Link>
          <Link to="/bins" className="btn">
            All bins
          </Link>
        </div>
      </div>
    );

  const inBin = parts.filter((p) => p.binId === bin.id).sort((a, b) => Number(a.movedBack) - Number(b.movedBack) || a.name.localeCompare(b.name));
  const s = binStats(bin.id, parts);

  async function toggle(id: string, value: boolean) {
    try {
      await setMovedBack(id, value);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <div className="row-between">
          <BinLabel code={bin.binCode} />
          <Link to={`/bins/${bin.id}/edit`} className="btn small">
            Edit bin
          </Link>
        </div>
        {bin.labelText && <p className="lead">{bin.labelText}</p>}
        <p className="sub">{[bin.shelfZone, bin.binSize].filter(Boolean).join(" · ")}</p>
      </header>

      <div className="tiles three">
        <div className="tile">
          <span className="k">Parts</span>
          <span className="v">{s.parts}</span>
        </div>
        <div className="tile">
          <span className="k">Units</span>
          <span className="v">{fmtQty(s.units)}</span>
        </div>
        <div className={`tile ${s.notPutAway ? "warn" : ""}`}>
          <span className="k">To put away</span>
          <span className="v">{s.notPutAway}</span>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="actions-row">
        <Link to={`/queue/needs-bin?bin=${bin.id}`} className="btn">
          Add parts to this bin
        </Link>
        {s.notPutAway > 0 && (
          <button
            type="button"
            className="btn primary"
            onClick={async () => {
              const n = await putAwayBin(bin.id);
              toast(`${n} part${n === 1 ? "" : "s"} put away in ${bin.binCode}`);
            }}
          >
            All put away
          </button>
        )}
      </div>

      {inBin.length === 0 ? (
        <div className="empty">
          <strong>Empty</strong>No parts assigned to this bin yet.
        </div>
      ) : (
        <ul className="list">
          {inBin.map((p) => (
            <li key={p.id} className="part-row static">
              <Link to={`/parts/${p.id}`} className="part-main">
                <span className="part-name">{p.name}</span>
                <span className="part-meta">
                  <span className="mono">{p.partId}</span>
                  <span>Qty {fmtQty(p.qty)}</span>
                </span>
                <span className="chips">
                  <StatusChip part={p} />
                </span>
              </Link>
              <button type="button" className={`btn putaway ${p.movedBack ? "done" : ""}`} aria-pressed={p.movedBack} onClick={() => toggle(p.id, !p.movedBack)}>
                {p.movedBack ? "✓ In bin" : "Put away"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Kept parts with no bin. Pick several, pick a bin, assign.
export function NeedsBin() {
  const parts = useParts();
  const bins = useBins();
  const systems = useSystems();
  const [params] = useSearchParams();
  const [binId, setBinId] = useState(params.get("bin") ?? "");
  const [system, setSystem] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toast = useToast();
  const idx = useMemo(() => indexSystems(systems ?? []), [systems]);

  const queue = useMemo(
    () =>
      (parts ?? [])
        .filter((p) => placementOf(p) === "Needs bin" && (!system || idx.within(p.systemId, system)))
        .sort((a, b) => (idx.label(a.systemId) || "~").localeCompare(idx.label(b.systemId) || "~") || a.name.localeCompare(b.name)),
    [parts, system, idx],
  );

  const flip = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selected = [...picked].filter((id) => queue.some((p) => p.id === id));

  async function assign() {
    if (!binId || !selected.length) return;
    const n = await assignBin(selected, binId);
    const code = bins?.find((b) => b.id === binId)?.binCode;
    toast(`${n} part${n === 1 ? "" : "s"} assigned to ${code}`);
    setPicked(new Set());
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Needs bin</h1>
        <p className="sub">Kept parts with no bin yet. Pick parts, pick a bin, assign.</p>
      </header>

      {bins && bins.length === 0 ? (
        <div className="notice">
          Add your bins first. <Link to="/bins/new">Add a bin</Link>
        </div>
      ) : (
        <div className="filters">
          <select aria-label="Bin to assign" value={binId} onChange={(e) => setBinId(e.target.value)}>
            <option value="">Choose a bin…</option>
            {bins?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.binCode}
                {b.labelText ? ` · ${b.labelText}` : ""}
              </option>
            ))}
          </select>
          <select aria-label="Filter by system" value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">All systems</option>
            {idx.options().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {parts && queue.length === 0 ? (
        <div className="empty">
          <strong>Nothing waiting</strong>Every kept part{system ? " in this system" : ""} has a bin.
        </div>
      ) : (
        <ul className="list">
          {queue.map((p) => (
            <li key={p.id}>
              <label className={`pick-row ${picked.has(p.id) ? "on" : ""}`} data-ctx={`part:${p.id}`}>
                <input type="checkbox" checked={picked.has(p.id)} onChange={() => flip(p.id)} />
                <span className="part-main">
                  <span className="part-name">{p.name}</span>
                  <span className="part-meta">
                    <span className="mono">{p.partId}</span>
                    {p.systemId && <span>{idx.label(p.systemId)}</span>}
                    <span>Qty {fmtQty(p.qty)}</span>
                    {p.oldLocation && <span>was: {p.oldLocation}</span>}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="sticky-actions">
        <button type="button" className="btn primary big" disabled={!binId || !selected.length} onClick={assign}>
          {selected.length
            ? binId
              ? `Assign ${selected.length} to ${bins?.find((b) => b.id === binId)?.binCode ?? "bin"}`
              : `Choose a bin for ${selected.length} part${selected.length === 1 ? "" : "s"}`
            : "Pick parts to assign"}
        </button>
      </div>
    </div>
  );
}

// Assigned but not yet physically in the bin, grouped by bin.
export function Staged() {
  const parts = useParts();
  const bins = useBins();
  const toast = useToast();
  const groups = useMemo(() => {
    const staged = (parts ?? []).filter((p) => placementOf(p) === "Staged");
    return (bins ?? []).map((b) => ({ bin: b, parts: staged.filter((p) => p.binId === b.id) })).filter((g) => g.parts.length);
  }, [parts, bins]);

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Staged</h1>
        <p className="sub">Assigned to a bin but not put away yet.</p>
      </header>
      {parts && groups.length === 0 && (
        <div className="empty">
          <strong>Nothing staged</strong>Every part with a bin is in it.
        </div>
      )}
      {groups.map(({ bin, parts: ps }) => (
        <section key={bin.id} className="group">
          <div className="row-between group-head">
            <Link to={`/b/${encodeURIComponent(bin.binCode)}`} className="row-gap" data-ctx={`bin:${bin.id}`}>
              <BinLabel code={bin.binCode} />
              <span className="sub">{bin.labelText}</span>
            </Link>
            <button
              type="button"
              className="btn small primary"
              onClick={async () => {
                const n = await putAwayBin(bin.id);
                toast(`${n} put away in ${bin.binCode}`);
              }}
            >
              All put away
            </button>
          </div>
          <ul className="list">
            {ps.map((p) => (
              <li key={p.id} className="part-row static" data-ctx={`part:${p.id}`}>
                <Link to={`/parts/${p.id}`} className="part-main">
                  <span className="part-name">{p.name}</span>
                  <span className="part-meta">
                    <span className="mono">{p.partId}</span>
                    <span>Qty {fmtQty(p.qty)}</span>
                  </span>
                </Link>
                <button type="button" className="btn putaway" onClick={() => setMovedBack(p.id, true)}>
                  Put away
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
