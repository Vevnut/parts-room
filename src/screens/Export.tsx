// Download the parts list as an Excel or CSV file laid out for a Lightspeed DMS parts import.
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { COLUMN_HINTS, DEFAULT_EXPORT_COLUMNS, buildExport, loadColumns, toCsv, type ExportColumn, type ExportOptions } from "../domain/export";
import { buildXlsx } from "../domain/xlsx";
import { useSync } from "../sync/SyncProvider";
import { ago } from "../sync/SyncBar";
import { today, useBins, useParts, useToast } from "../ui";

const KEY = "export.lightspeed";
const DEFAULT_OPTS: ExportOptions = { keptOnly: true, numberedOnly: true, skipZeroQty: false };
const PREVIEW_ROWS = 5;

interface Saved {
  columns: ExportColumn[];
  opts: ExportOptions;
}

function readSaved(v: unknown): Saved {
  const s = (v ?? {}) as Partial<Saved>;
  const o = (s.opts ?? {}) as Partial<ExportOptions>;
  return {
    columns: loadColumns(s.columns),
    opts: {
      keptOnly: typeof o.keptOnly === "boolean" ? o.keptOnly : DEFAULT_OPTS.keptOnly,
      numberedOnly: typeof o.numberedOnly === "boolean" ? o.numberedOnly : DEFAULT_OPTS.numberedOnly,
      skipZeroQty: typeof o.skipZeroQty === "boolean" ? o.skipZeroQty : DEFAULT_OPTS.skipZeroQty,
    },
  };
}

function saveFile(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function Export() {
  const parts = useParts();
  const bins = useBins();
  const toast = useToast();
  const sync = useSync();
  const stored = useLiveQuery(async () => (await db.settings.get(KEY))?.value ?? null, [], undefined);
  const saved = useMemo(() => readSaved(stored), [stored]);
  const { columns, opts } = saved;

  const result = useMemo(() => (parts && bins ? buildExport(parts, bins, columns, opts) : null), [parts, bins, columns, opts]);

  // Each change starts from what's stored, so a rename saved on blur isn't lost to a tap that follows it.
  const update = (fn: (s: Saved) => Partial<Saved>) =>
    db.transaction("rw", db.settings, async () => {
      const cur = readSaved((await db.settings.get(KEY))?.value);
      await db.settings.put({ key: KEY, value: { ...cur, ...fn(cur) } });
    });
  const setOpt = (patch: Partial<ExportOptions>) => void update((s) => ({ opts: { ...s.opts, ...patch } }));
  const setCol = (key: ExportColumn["key"], patch: Partial<ExportColumn>) =>
    void update((s) => ({ columns: s.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const move = (key: ExportColumn["key"], d: -1 | 1) =>
    void update((s) => {
      const next = [...s.columns];
      const i = next.findIndex((c) => c.key === key);
      if (i < 0 || i + d < 0 || i + d >= next.length) return {};
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return { columns: next };
    });

  function download(kind: "xlsx" | "csv") {
    if (!result) return;
    const name = `parts-lightspeed-${today()}.${kind}`;
    if (kind === "xlsx") saveFile(buildXlsx("Parts", result.header, result.rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name);
    else saveFile(toCsv(result.header, result.rows), "text/csv;charset=utf-8", name);
    toast(`Downloaded ${plural(result.rows.length, "part")}`);
  }

  if (!result || stored === undefined) return <div className="screen" />;
  const s = result.skipped;
  const left = [
    s.notKept ? `${plural(s.notKept, "part")} marked Toss or Donate/Sell` : "",
    s.noNumber ? `${plural(s.noNumber, "part")} with no mfr part #` : "",
    s.zeroQty ? `${plural(s.zeroQty, "part")} with zero quantity` : "",
  ].filter(Boolean);
  const noColumns = result.header.length === 0;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Export for Lightspeed</h1>
        <p className="sub">An Excel sheet of your parts, one row per part, ready for a Lightspeed DMS parts import.</p>
      </header>

      <section className="card stack">
        <p>
          <b>{plural(result.rows.length, "part")}</b> will be in the file.
          {left.length > 0 && <span className="sub block">Left out: {left.join(", ")}.</span>}
        </p>
        <p className="sub">
          Uses what's on this device
          {sync.phase === "signed-out" ? " (not syncing)" : ` (last synced ${ago(sync.lastSyncAt)}${sync.pending ? `, ${plural(sync.pending, "change")} not synced yet` : ""})`}.
        </p>
        <div className="actions-row">
          <button type="button" className="btn primary big" disabled={noColumns || !result.rows.length} onClick={() => download("xlsx")}>
            Download Excel (.xlsx)
          </button>
          <button type="button" className="btn" disabled={noColumns || !result.rows.length} onClick={() => download("csv")}>
            Download CSV
          </button>
        </div>
        {noColumns && <p className="error">Switch on at least one column below.</p>}
      </section>

      <section className="card stack">
        <h2>Which parts</h2>
        <label className="check">
          <input type="checkbox" checked={opts.keptOnly} onChange={(e) => setOpt({ keptOnly: e.target.checked })} />
          Only parts you're keeping (leave out Toss and Donate/Sell)
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.numberedOnly} onChange={(e) => setOpt({ numberedOnly: e.target.checked })} />
          Only parts with a mfr part # (Lightspeed matches parts by number)
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.skipZeroQty} onChange={(e) => setOpt({ skipZeroQty: e.target.checked })} />
          Leave out parts with zero quantity
        </label>
      </section>

      {result.rows.length > 0 && !noColumns && (
        <section className="stack">
          <h2>Preview</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>{result.header.map((h, i) => <th key={i}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {result.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={typeof v === "number" ? "num" : undefined}>{v ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.rows.length > PREVIEW_ROWS && <p className="sub">…and {plural(result.rows.length - PREVIEW_ROWS, "more row")}.</p>}
        </section>
      )}

      <section className="stack">
        <h2>Columns</h2>
        <p className="sub">
          Lightspeed's import needs its own column headings. Get the parts import template from Lightspeed support, then rename, order and switch columns here to
          match it. Saved on this device.
        </p>
        <ul className="list">
          {columns.map((c, i) => (
            <li key={c.key} className={`system-row${c.enabled ? "" : " hidden-system"}`}>
              <label className="check">
                <input type="checkbox" checked={c.enabled} aria-label={`Include ${COLUMN_HINTS[c.key]}`} onChange={(e) => setCol(c.key, { enabled: e.target.checked })} />
              </label>
              <div className="system-name">
                <input
                  defaultValue={c.header}
                  key={`${c.key}:${c.header}`}
                  aria-label={`Heading for ${COLUMN_HINTS[c.key]}`}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (!v) e.target.value = c.header;
                    else if (v !== c.header) setCol(c.key, { header: v });
                  }}
                />
                <small className="hint">{COLUMN_HINTS[c.key]}</small>
              </div>
              <div className="system-actions">
                <button type="button" className="btn small" aria-label={`Move ${c.header} up`} disabled={i === 0} onClick={() => move(c.key, -1)}>
                  ↑
                </button>
                <button type="button" className="btn small" aria-label={`Move ${c.header} down`} disabled={i === columns.length - 1} onClick={() => move(c.key, 1)}>
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={() => void update(() => ({ columns: DEFAULT_EXPORT_COLUMNS.map((c) => ({ ...c })) }))}>
          Reset columns
        </button>
      </section>
    </div>
  );
}
