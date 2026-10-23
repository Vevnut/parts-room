// Parts list with search and filters, and the full add/edit form.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { ValidationError, deletePart, duplicatePart, savePart, stripPart, suggestPartId } from "../db/repo";
import { distinctOptions, filterParts, manufacturerOptions } from "../domain/search";
import { indexSystems } from "../domain/systems";
import { PartPhotos } from "./Photos";
import {
  CONDITIONS,
  DISPOSITIONS,
  MANUFACTURERS,
  isKept,
  totalValue,
  type Condition,
  type Disposition,
  type Part,
  type PartErrors,
} from "../domain/rules";
import {
  BinLabel,
  Choice,
  ConfirmButton,
  Field,
  PlacementChip,
  StatusChip,
  Stepper,
  fmtMoney,
  fmtQty,
  parseNum,
  today,
  useBins,
  useDraft,
  useParts,
  useSystems,
  useToast,
} from "../ui";

// ---------------- list ----------------

const STATUSES = ["OK", "Reorder", "Out of stock", "Not kept"];
const PLACEMENTS = ["Needs bin", "Staged", "Put away"];
const FILTER_KEYS = ["mfr", "loc", "system", "bin", "status", "placement", "disposition", "details", "noprice"];

export function PartsList() {
  const parts = useParts();
  const bins = useBins();
  const systems = useSystems();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? "";
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const [showFilters, setShowFilters] = useState(() => FILTER_KEYS.some((k) => params.has(k)));

  const binCode = useMemo(() => new Map((bins ?? []).map((b) => [b.id, b.binCode])), [bins]);
  const idx = useMemo(() => indexSystems(systems ?? []), [systems]);

  const manufacturers = useMemo(() => manufacturerOptions(parts ?? []), [parts]);
  const photoCounts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const p of await db.photos.filter((x) => !x.deletedAt).toArray()) m.set(p.partId, (m.get(p.partId) ?? 0) + 1);
    return m;
  }, []);
  const locations = useMemo(() => distinctOptions(parts ?? [], "oldLocation"), [parts]);

  const rows = useMemo(() => {
    if (!parts) return [];
    const r = filterParts(
      parts,
      {
        q: params.get("q") ?? "",
        mfr: params.get("mfr") ?? "",
        loc: params.get("loc") ?? "",
        noPrice: !!params.get("noprice"),
        system: params.get("system") ?? "",
        bin: params.get("bin") ?? "",
        status: params.get("status") ?? "",
        placement: params.get("placement") ?? "",
        disposition: params.get("disposition") ?? "",
        details: !!params.get("details"),
      },
      (id) => binCode.get(id) ?? "",
      (id) => idx.get(id)?.parentId ?? null,
    );
    const sort = params.get("sort") || "recent";
    return r.sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "id" ? a.partId.localeCompare(b.partId, undefined, { numeric: true }) : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [parts, params, binCode]);

  const activeFilters = FILTER_KEYS.filter((k) => params.has(k)).length;

  return (
    <div className="screen">
      <header className="screen-head row-between">
        <h1>Parts</h1>
        <Link to="/parts/new" className="btn">
          New part
        </Link>
      </header>

      <input
        type="search"
        className="search"
        placeholder="Search name, Part ID, part #, manufacturer…"
        aria-label="Search parts"
        value={get("q")}
        onChange={(e) => setParam("q", e.target.value)}
      />

      <div className="row-between">
        <button type="button" className="btn small" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{activeFilters ? ` (${activeFilters})` : ""}
        </button>
        <select aria-label="Sort" value={get("sort") || "recent"} onChange={(e) => setParam("sort", e.target.value === "recent" ? "" : e.target.value)}>
          <option value="recent">Recently changed</option>
          <option value="name">Name</option>
          <option value="id">Part ID</option>
        </select>
      </div>

      {showFilters && (
        <div className="filters">
          <select aria-label="Manufacturer" value={get("mfr").toLowerCase()} onChange={(e) => setParam("mfr", e.target.value)}>
            <option value="">All manufacturers</option>
            <option value="none">No manufacturer</option>
            {manufacturers.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label} ({m.count})
              </option>
            ))}
          </select>
          <select aria-label="Old location" value={get("loc").toLowerCase()} onChange={(e) => setParam("loc", e.target.value)}>
            <option value="">All old locations</option>
            <option value="none">No old location</option>
            {locations.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label} ({l.count})
              </option>
            ))}
          </select>
          <select aria-label="System" value={get("system")} onChange={(e) => setParam("system", e.target.value)}>
            <option value="">All systems</option>
            <option value="none">No system</option>
            {idx.options().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select aria-label="Bin" value={get("bin")} onChange={(e) => setParam("bin", e.target.value)}>
            <option value="">All bins</option>
            <option value="none">No bin</option>
            {bins?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.binCode}
              </option>
            ))}
          </select>
          <select aria-label="Status" value={get("status")} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Placement" value={get("placement")} onChange={(e) => setParam("placement", e.target.value)}>
            <option value="">Any placement</option>
            {PLACEMENTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Disposition" value={get("disposition")} onChange={(e) => setParam("disposition", e.target.value)}>
            <option value="">Any disposition</option>
            <option value="blank">Blank (counts as Keep)</option>
            {DISPOSITIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={!!get("details")} onChange={(e) => setParam("details", e.target.checked ? "1" : "")} />
            Needs details
          </label>
          <label className="check">
            <input type="checkbox" checked={!!get("noprice")} onChange={(e) => setParam("noprice", e.target.checked ? "1" : "")} />
            No price yet
          </label>
          {activeFilters > 0 && (
            <button type="button" className="btn small" onClick={() => setParams(params.get("q") ? { q: params.get("q")! } : {}, { replace: true })}>
              Clear filters
            </button>
          )}
        </div>
      )}

      <p className="count">{parts ? `${rows.length} of ${parts.length} parts` : "Loading…"}</p>

      {parts && parts.length === 0 ? (
        <div className="empty">
          <strong>No parts yet</strong>
          Use Quick add to log parts as they come off the shelves.
          <Link to="/add" className="btn primary">
            Quick add
          </Link>
        </div>
      ) : (
        <ul className="list">
          {rows.map((p) => (
            <li key={p.id}>
              <Link to={`/parts/${p.id}`} className="part-row" data-ctx={`part:${p.id}`}>
                <div className="part-main">
                  <span className="part-name">{p.name}</span>
                  <span className="part-meta">
                    <span className="mono">{p.partId}</span>
                    {p.manufacturer && <span>{p.manufacturer}</span>}
                    {p.mfrPartNumber && <span className="mono">{p.mfrPartNumber}</span>}
                    {p.systemId && <span>{idx.label(p.systemId)}</span>}
                  </span>
                  <span className="chips">
                    <StatusChip part={p} />
                    <PlacementChip part={p} />
                    {p.needsDetails && <span className="chip muted">Needs details</span>}
                    {!!photoCounts?.get(p.id) && <span className="chip info">{photoCounts.get(p.id)} photo{photoCounts.get(p.id) === 1 ? "" : "s"}</span>}
                  </span>
                </div>
                <div className="part-side">
                  <span className="qty">{fmtQty(p.qty)}</span>
                  {p.binId && binCode.get(p.binId) && <BinLabel code={binCode.get(p.binId)!} />}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- edit ----------------

interface Form {
  partId: string;
  name: string;
  systemId: string | null;
  qty: number;
  condition: Condition | null;
  disposition: Disposition | null;
  oldLocation: string;
  binId: string | null;
  movedBack: boolean;
  manufacturer: string;
  mfrPartNumber: string;
  supplier: string;
  minQty: string;
  reorderQty: string;
  unitCost: string;
  retailPrice: string;
  lastCounted: string;
  replaceBy: string;
  photoLink: string;
  notes: string;
  needsDetails: boolean;
}

const numText = (n: number | null) => (n == null ? "" : String(n));

function toForm(p: Part | null, partId: string): Form {
  return {
    partId: p?.partId ?? partId,
    name: p?.name ?? "",
    systemId: p?.systemId ?? null,
    qty: p?.qty ?? 1,
    condition: p?.condition ?? null,
    disposition: p ? p.disposition : "Keep",
    oldLocation: p?.oldLocation ?? "",
    binId: p?.binId ?? null,
    movedBack: p?.movedBack ?? false,
    manufacturer: p?.manufacturer ?? "",
    mfrPartNumber: p?.mfrPartNumber ?? "",
    supplier: p?.supplier ?? "",
    minQty: numText(p?.minQty ?? null),
    reorderQty: numText(p?.reorderQty ?? null),
    unitCost: numText(p?.unitCost ?? null),
    retailPrice: numText(p?.retailPrice ?? null),
    lastCounted: p?.lastCounted ?? "",
    replaceBy: p?.replaceBy ?? "",
    photoLink: p?.photoLink ?? "",
    notes: p?.notes ?? "",
    needsDetails: false, // saving the full form marks the details done unless re-checked
  };
}

export function PartEdit() {
  const { id = "new" } = useParams();
  const isNew = id === "new";
  const loaded = useLiveQuery(async () => {
    if (isNew) return { part: null, partId: await suggestPartId() };
    const row = await db.parts.get(id);
    return row && !row.deletedAt ? { part: stripPart(row), partId: row.partId } : { part: undefined, partId: "" };
  }, [id]);

  if (!loaded) return <div className="screen">Loading…</div>;
  if (loaded.part === undefined)
    return (
      <div className="screen">
        <div className="empty">
          <strong>Part not found</strong>It may have been deleted.
          <Link to="/parts" className="btn">
            Back to parts
          </Link>
        </div>
      </div>
    );
  // Keyed by id only, so a live update to this part doesn't wipe what's being typed.
  return <PartForm key={id} part={loaded.part} initial={toForm(loaded.part, loaded.partId)} />;
}

function PartForm({ part, initial }: { part: Part | null; initial: Form }) {
  const draft = useDraft<Form>(`part:${part?.id ?? "new"}`, initial);
  const f = draft.value;
  const set = (patch: Partial<Form>) => draft.setValue({ ...f, ...patch });
  const bins = useBins();
  const systems = useSystems();
  // f.systemId holds the sub-system when one is picked, otherwise the main system.
  const idx = useMemo(() => indexSystems(systems ?? []), [systems]);
  const mainId = idx.mainOf(f.systemId);
  const subId = idx.subOf(f.systemId);
  const subChoices = mainId ? idx.subs(mainId).filter((s) => s.active || s.id === subId) : [];
  const navigate = useNavigate();
  const toast = useToast();
  const [errors, setErrors] = useState<PartErrors>({});
  const [formError, setFormError] = useState("");

  const syncIssue = useLiveQuery(async () => (part ? (await db.outbox.get(["parts", part.id]))?.conflict ?? null : null), [part?.id]);
  const kept = isKept({ disposition: f.disposition });
  const unitCost = parseNum(f.unitCost);
  const preview = {
    ...f,
    minQty: parseNum(f.minQty),
    unitCost,
    binId: kept ? f.binId : null,
    movedBack: kept && !!f.binId && f.movedBack,
  } as unknown as Part;

  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate("/parts"));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const nums = { minQty: parseNum(f.minQty), reorderQty: parseNum(f.reorderQty), unitCost, retailPrice: parseNum(f.retailPrice) };
    const numErrors: PartErrors = {};
    for (const [k, v] of Object.entries(nums)) if (Number.isNaN(v)) numErrors[k as keyof Part] = "Enter a number.";
    if (Object.keys(numErrors).length) {
      setErrors(numErrors);
      return;
    }
    try {
      const saved = await savePart({
        ...(part ?? {}),
        ...f,
        ...nums,
        id: part?.id,
        binId: kept ? f.binId : null,
        movedBack: kept && !!f.binId && f.movedBack,
        lastCounted: f.lastCounted || null,
        replaceBy: f.replaceBy || null,
      });
      draft.reset(toForm(saved, saved.partId));
      toast(`Saved ${saved.partId}`);
      goBack();
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.errors);
      else if ((err as Error).name === "PartIdTakenError") setErrors({ partId: (err as Error).message });
      else setFormError((err as Error).message);
    }
  }

  async function remove() {
    if (!part) return;
    await deletePart(part.id);
    draft.reset(initial);
    toast(`Deleted ${part.partId}`);
    navigate("/parts", { replace: true });
  }

  function cancel() {
    draft.reset(initial);
    goBack();
  }

  // Copies the saved part (not unsaved edits) and opens the copy, e.g. to split a lot.
  async function duplicate() {
    if (!part) return;
    const copy = await duplicatePart(part.id);
    toast(`Copied to ${copy.partId}`);
    navigate(`/parts/${copy.id}`);
  }

  return (
    <form className="screen" onSubmit={save} noValidate>
      <header className="screen-head">
        <div className="row-between">
          <h1>{part ? part.partId : "New part"}</h1>
          {part && (
            <button type="button" className="btn small" onClick={() => void duplicate()}>
              Duplicate
            </button>
          )}
        </div>
        <div className="chips">
          <StatusChip part={preview} />
          <PlacementChip part={preview} />
          {unitCost != null && !Number.isNaN(unitCost) && <span className="chip muted">Value {fmtMoney(totalValue(preview))}</span>}
        </div>
      </header>

      {syncIssue && <div className="notice bad">{syncIssue}</div>}

      {draft.restored && (
        <div className="notice row-between">
          <span>Restored unsaved changes.</span>
          <button type="button" className="btn small" onClick={() => draft.reset(initial)}>
            Discard
          </button>
        </div>
      )}

      <fieldset>
        <legend>Basics</legend>
        <Field label="Part ID" error={errors.partId} hint="Used later as the Lightspeed SKU">
          <input value={f.partId} onChange={(e) => set({ partId: e.target.value })} autoCapitalize="characters" autoComplete="off" />
        </Field>
        <Field label="Part name" error={errors.name}>
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="System">
          <select value={mainId ?? ""} onChange={(e) => set({ systemId: e.target.value || null })}>
            <option value="">— None —</option>
            {idx.mains
              .filter((s) => s.active || s.id === mainId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (hidden)"}
                </option>
              ))}
          </select>
        </Field>
        {subChoices.length > 0 && (
          <Field label="Sub-system">
            <select value={subId ?? ""} onChange={(e) => set({ systemId: e.target.value || mainId })}>
              <option value="">— None —</option>
              {subChoices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.active ? "" : " (hidden)"}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="field">
          <span className="field-label">Qty on hand</span>
          <Stepper label="Qty on hand" value={f.qty} onChange={(qty) => set({ qty })} />
          {errors.qty && <small className="error">{errors.qty}</small>}
        </div>
        <div className="field">
          <span className="field-label">Disposition</span>
          <Choice label="Disposition" allowNone value={f.disposition} onChange={(disposition) => set({ disposition })} options={DISPOSITIONS.map((d) => ({ value: d, label: d }))} />
          <small className="hint">Tap again to clear. Blank counts as Keep.</small>
        </div>
        <div className="field">
          <span className="field-label">Condition</span>
          <Choice label="Condition" allowNone value={f.condition} onChange={(condition) => set({ condition })} options={CONDITIONS.map((c) => ({ value: c, label: c }))} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Location</legend>
        <Field label="Old location" hint="Where it was in the old room">
          <input value={f.oldLocation} onChange={(e) => set({ oldLocation: e.target.value })} placeholder="e.g. Shelf 3 left" />
        </Field>
        <Field label="New bin" hint={kept ? undefined : "Toss and Donate/Sell parts don't go in bins."}>
          <select value={kept ? f.binId ?? "" : ""} disabled={!kept} onChange={(e) => set({ binId: e.target.value || null, movedBack: e.target.value ? f.movedBack : false })}>
            <option value="">— No bin yet —</option>
            {bins?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.binCode}
                {b.labelText ? ` · ${b.labelText}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <label className={`toggle${!kept || !f.binId ? " disabled" : ""}`}>
          <input type="checkbox" checked={kept && !!f.binId && f.movedBack} disabled={!kept || !f.binId} onChange={(e) => set({ movedBack: e.target.checked })} />
          <span>Moved back: it's physically in the bin</span>
        </label>
        {errors.movedBack && <small className="error">{errors.movedBack}</small>}
      </fieldset>

      <fieldset>
        <legend>Stock &amp; reorder</legend>
        <div className="grid2">
          <Field label="Min qty" error={errors.minQty} hint="Reorder at or below">
            <input inputMode="decimal" value={f.minQty} onChange={(e) => set({ minQty: e.target.value })} />
          </Field>
          <Field label="Reorder qty" error={errors.reorderQty}>
            <input inputMode="decimal" value={f.reorderQty} onChange={(e) => set({ reorderQty: e.target.value })} />
          </Field>
        </div>
        <div className="grid2">
          <Field label="Last counted">
            <input type="date" value={f.lastCounted} onChange={(e) => set({ lastCounted: e.target.value })} />
          </Field>
          <div className="field">
            <span className="field-label">&nbsp;</span>
            <button type="button" className="btn" onClick={() => set({ lastCounted: today() })}>
              Counted today
            </button>
          </div>
        </div>
        <Field label="Replace by">
          <input type="date" value={f.replaceBy} onChange={(e) => set({ replaceBy: e.target.value })} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Supplier &amp; pricing</legend>
        <Field label="Manufacturer">
          <input list="manufacturers" value={f.manufacturer} onChange={(e) => set({ manufacturer: e.target.value })} autoComplete="off" />
        </Field>
        <datalist id="manufacturers">
          {MANUFACTURERS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <Field label="Mfr part #">
          <input value={f.mfrPartNumber} onChange={(e) => set({ mfrPartNumber: e.target.value })} autoCapitalize="characters" autoComplete="off" />
        </Field>
        <Field label="Supplier">
          <input value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} autoComplete="off" />
        </Field>
        <div className="grid2">
          <Field label="Unit cost ($)" error={errors.unitCost}>
            <input inputMode="decimal" value={f.unitCost} onChange={(e) => set({ unitCost: e.target.value })} placeholder="0.00" />
          </Field>
          <Field label="Retail price ($)" error={errors.retailPrice}>
            <input inputMode="decimal" value={f.retailPrice} onChange={(e) => set({ retailPrice: e.target.value })} placeholder="0.00" />
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend>Photos</legend>
        {part ? <PartPhotos partId={part.id} partLabel={`${part.partId} ${part.name}`} /> : <p className="sub">Save the part first, then add photos.</p>}
      </fieldset>

      <fieldset>
        <legend>Notes</legend>
        <Field label="Photo / link">
          <input value={f.photoLink} onChange={(e) => set({ photoLink: e.target.value })} placeholder="Link to a photo, for now" />
        </Field>
        <Field label="Notes">
          <textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <label className="toggle">
          <input type="checkbox" checked={f.needsDetails} onChange={(e) => set({ needsDetails: e.target.checked })} />
          <span>Still needs details</span>
        </label>
      </fieldset>

      {formError && <p className="error">{formError}</p>}

      <div className="sticky-actions">
        {part && (
          <ConfirmButton className="btn danger" confirmText="Tap again to delete" onConfirm={remove}>
            Delete
          </ConfirmButton>
        )}
        <button type="button" className="btn" onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Save
        </button>
      </div>
    </form>
  );
}
