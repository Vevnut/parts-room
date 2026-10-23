// Change the same fields on many parts at once (picked on the Parts list). Every field starts
// as "Leave as is"; only the ones set here change.
import { useState } from "react";
import { updateParts, type BulkPatch } from "../db/repo";
import { CONDITIONS, DISPOSITIONS, type Condition, type Disposition } from "../domain/rules";
import type { SystemIndex } from "../domain/systems";
import { Field, useToast } from "../ui";

const LEAVE = "";
const CLEAR = "__clear__";

export default function BulkEdit({ ids, idx, onDone }: { ids: string[]; idx: SystemIndex; onDone: () => void }) {
  const toast = useToast();
  const [main, setMain] = useState(LEAVE);
  const [sub, setSub] = useState(LEAVE);
  const [disposition, setDisposition] = useState(LEAVE);
  const [condition, setCondition] = useState(LEAVE);
  const [oldLocation, setOldLocation] = useState("");
  const [stagingSpot, setStagingSpot] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [details, setDetails] = useState(LEAVE);
  const [busy, setBusy] = useState(false);

  const subChoices = main && main !== CLEAR ? idx.subs(main).filter((s) => s.active) : [];

  function patch(): BulkPatch {
    const out: BulkPatch = {};
    if (main === CLEAR) out.systemId = null;
    else if (main) out.systemId = sub || main;
    if (disposition) out.disposition = disposition === CLEAR ? null : (disposition as Disposition);
    if (condition) out.condition = condition === CLEAR ? null : (condition as Condition);
    if (oldLocation.trim()) out.oldLocation = oldLocation;
    if (stagingSpot.trim()) out.stagingSpot = stagingSpot;
    if (manufacturer.trim()) out.manufacturer = manufacturer;
    if (details) out.needsDetails = details === "yes";
    return out;
  }
  const changes = Object.keys(patch()).length;

  async function apply() {
    setBusy(true);
    try {
      const n = await updateParts(ids, patch());
      toast(`Changed ${n} part${n === 1 ? "" : "s"}`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack bulk-edit" aria-label="Change selected parts">
      <h2>
        Change {ids.length} part{ids.length === 1 ? "" : "s"}
      </h2>
      <p className="sub">Only what you set here changes. Everything left on "Leave as is" stays the same.</p>
      <Field label="System">
        <select
          value={main}
          onChange={(e) => {
            setMain(e.target.value);
            setSub(LEAVE);
          }}
        >
          <option value={LEAVE}>Leave as is</option>
          <option value={CLEAR}>— No system —</option>
          {idx.mains
            .filter((s) => s.active)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </Field>
      {subChoices.length > 0 && (
        <Field label="Sub-system">
          <select value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value={LEAVE}>— None —</option>
            {subChoices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid2">
        <Field label="Disposition">
          <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>
            <option value={LEAVE}>Leave as is</option>
            <option value={CLEAR}>Blank (counts as Keep)</option>
            {DISPOSITIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Condition">
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value={LEAVE}>Leave as is</option>
            <option value={CLEAR}>Blank</option>
            {CONDITIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid2">
        <Field label="Old location" hint="Blank leaves it as is">
          <input value={oldLocation} onChange={(e) => setOldLocation(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Manufacturer" hint="Blank leaves it as is">
          <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} autoComplete="off" />
        </Field>
      </div>
      <Field label="Container spot" hint="Blank leaves it as is">
        <input value={stagingSpot} onChange={(e) => setStagingSpot(e.target.value)} placeholder="e.g. Container A shelf 2" autoComplete="off" />
      </Field>
      <Field label="Needs details">
        <select value={details} onChange={(e) => setDetails(e.target.value)}>
          <option value={LEAVE}>Leave as is</option>
          <option value="yes">Yes, still needs details</option>
          <option value="no">No, details are done</option>
        </select>
      </Field>
      {disposition === "Toss" || disposition === "Donate/Sell" ? <p className="notice">Toss and Donate/Sell parts are taken out of their bins.</p> : null}
      <div className="actions-row">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy || !changes} onClick={() => void apply()}>
          {busy ? "Saving…" : `Apply to ${ids.length} part${ids.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </section>
  );
}
