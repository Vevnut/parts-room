// Progress summary: the spreadsheet's Summary tab.
import { Link } from "react-router-dom";
import { reorderList, statusOf, summarize } from "../domain/rules";
import { fmtMoney, fmtQty, useParts, useSystems } from "../ui";

export default function Home() {
  const parts = useParts();
  const systems = useSystems();
  if (!parts || !systems) return <div className="screen">Loading…</div>;

  const s = summarize(parts, systems);
  const pct = Math.round(s.pctPutAway * 100);
  const reorder = parts.filter((p) => statusOf(p) === "Reorder").length;
  const out = parts.filter((p) => statusOf(p) === "Out of stock").length;
  const needsDetails = parts.filter((p) => p.needsDetails).length;
  const reorderCost = reorderList(parts).totalCost;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Parts Room</h1>
        <p className="sub">Move-out and move-back progress</p>
      </header>

      {s.logged === 0 ? (
        <div className="empty">
          <strong>Nothing logged yet</strong>
          Start with Quick add as you take parts off the old shelves. Add your bins whenever you're ready to plan the move back.
          <Link to="/add" className="btn primary big">
            Quick add a part
          </Link>
        </div>
      ) : (
        <>
          <section className="progress-card" aria-label="Move-back progress">
            <div className="row-between">
              <span className="k">Kept parts put away</span>
              <span className="pct">{pct}%</span>
            </div>
            <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="tiles three">
              <Link to="/queue/needs-bin" className={`tile link ${s.needsBin ? "warn" : ""}`}>
                <span className="k">Needs bin</span>
                <span className="v">{s.needsBin}</span>
              </Link>
              <Link to="/queue/staged" className={`tile link ${s.staged ? "info" : ""}`}>
                <span className="k">Staged</span>
                <span className="v">{s.staged}</span>
              </Link>
              <Link to="/parts?placement=Put+away" className="tile link ok">
                <span className="k">Put away</span>
                <span className="v">{s.putAway}</span>
              </Link>
            </div>
          </section>

          <div className="tiles four">
            <Link to="/parts" className="tile link">
              <span className="k">Logged</span>
              <span className="v">{s.logged}</span>
            </Link>
            <div className="tile">
              <span className="k">Kept</span>
              <span className="v">{s.kept}</span>
            </div>
            <Link to="/parts?status=Not+kept" className="tile link">
              <span className="k">Not kept</span>
              <span className="v">{s.notKept}</span>
            </Link>
            <Link to="/parts?disposition=Unknown" className={`tile link ${s.unknown ? "warn" : ""}`}>
              <span className="k">Unknown</span>
              <span className="v">{s.unknown}</span>
            </Link>
          </div>

          <div className="tiles four">
            <div className="tile">
              <span className="k">Stock value</span>
              <span className="v small">{fmtMoney(s.stockValue)}</span>
            </div>
            <Link to="/parts?status=Reorder" className={`tile link ${reorder ? "warn" : ""}`}>
              <span className="k">Reorder</span>
              <span className="v">{reorder}</span>
            </Link>
            <Link to="/parts?status=Out+of+stock" className={`tile link ${out ? "bad" : ""}`}>
              <span className="k">Out of stock</span>
              <span className="v">{out}</span>
            </Link>
            <Link to="/parts?details=1" className="tile link">
              <span className="k">Needs details</span>
              <span className="v">{needsDetails}</span>
            </Link>
          </div>
          {reorderCost > 0 && <p className="sub">Estimated reorder cost: {fmtMoney(reorderCost)}</p>}

          <section>
            <h2>By system (kept parts)</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>System</th>
                    <th className="num">Parts</th>
                    <th className="num">Units</th>
                    <th className="num">Value</th>
                    <th className="num">Needs bin</th>
                    <th className="num">Reorder</th>
                    <th className="num">Out</th>
                  </tr>
                </thead>
                <tbody>
                  {s.bySystem.filter((r) => r.keptParts > 0 || systems.find((x) => x.id === r.systemId)?.active).map((r) => (
                    <tr key={r.systemId} className={r.keptParts ? "" : "dim"}>
                      <td>
                        <Link to={`/parts?system=${r.systemId}`}>{r.name}</Link>
                      </td>
                      <td className="num">{r.keptParts}</td>
                      <td className="num">{fmtQty(r.units)}</td>
                      <td className="num">{fmtMoney(r.value)}</td>
                      <td className="num">{r.needsBin}</td>
                      <td className="num">{r.reorder}</td>
                      <td className="num">{r.outOfStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.keptWithoutSystem > 0 && (
              <p className="sub">
                <Link to="/parts?system=none">{s.keptWithoutSystem} kept part{s.keptWithoutSystem === 1 ? " has" : "s have"} no system</Link>
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
