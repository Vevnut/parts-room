// Printable bin labels: a QR code that opens the bin's page, the bin code in large type, and
// its zone and label text. Pick the bins, then print (or save as PDF) from the browser.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { binLabelUrl } from "../domain/binLabels";
import type { Bin } from "../domain/rules";
import { useBins } from "../ui";

const SIZES = {
  small: { label: "Small (2 × 1 in)", qr: 88 },
  large: { label: "Large (4 × 2 in)", qr: 170 },
} as const;
type Size = keyof typeof SIZES;

// Draws the QR code as SVG. The QR library loads on first use (it's shared with the barcode scanner).
function QrCode({ text, size }: { text: string; size: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    import("@zxing/library")
      .then(({ BrowserQRCodeSvgWriter }) => {
        if (cancelled || !box.current) return;
        const svg = new BrowserQRCodeSvgWriter().write(text, size, size);
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", `QR code for ${text}`);
        box.current.replaceChildren(svg);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [text, size]);
  return (
    <span ref={box} className="qr" style={{ width: size, height: size }}>
      {failed ? "QR unavailable" : null}
    </span>
  );
}

function Label({ bin, size }: { bin: Bin; size: Size }) {
  const details = [bin.shelfZone, bin.labelText].filter(Boolean).join(" · ");
  return (
    <div className={`bin-label ${size}`}>
      <QrCode text={binLabelUrl(window.location.origin, bin.binCode)} size={SIZES[size].qr} />
      <span className="bin-label-text">
        <span className="bin-label-code">{bin.binCode}</span>
        {details && <span className="bin-label-details">{details}</span>}
      </span>
    </div>
  );
}

export default function Labels() {
  const bins = useBins();
  const [params] = useSearchParams();
  const wanted = useMemo(() => new Set((params.get("bins") ?? "").split(",").filter(Boolean)), [params]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [size, setSize] = useState<Size>("small");

  // Start with the bins named in the link, or every bin.
  const chosen = picked ?? new Set((bins ?? []).filter((b) => !wanted.size || wanted.has(b.id)).map((b) => b.id));
  const flip = (id: string) => {
    const n = new Set(chosen);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPicked(n);
  };
  const toPrint = (bins ?? []).filter((b) => chosen.has(b.id));

  if (!bins) return <div className="screen">Loading…</div>;

  return (
    <div className="screen labels-screen">
      <header className="screen-head no-print">
        <h1>Bin labels</h1>
        <p className="sub">Each label's QR code opens that bin in the app. Print on label stock or plain paper and cut them out.</p>
      </header>

      {bins.length === 0 ? (
        <div className="empty no-print">
          <strong>No bins yet</strong>
          <Link to="/bins/new" className="btn primary">
            Add a bin
          </Link>
        </div>
      ) : (
        <>
          <section className="card stack no-print">
            <div className="row-between">
              <select aria-label="Label size" value={size} onChange={(e) => setSize(e.target.value as Size)}>
                {(Object.keys(SIZES) as Size[]).map((k) => (
                  <option key={k} value={k}>
                    {SIZES[k].label}
                  </option>
                ))}
              </select>
              <span className="row-gap">
                <button type="button" className="btn small" onClick={() => setPicked(new Set(bins.map((b) => b.id)))}>
                  All
                </button>
                <button type="button" className="btn small" onClick={() => setPicked(new Set())}>
                  None
                </button>
              </span>
            </div>
            <div className="label-picks">
              {bins.map((b) => (
                <label key={b.id} className="check">
                  <input type="checkbox" checked={chosen.has(b.id)} onChange={() => flip(b.id)} />
                  {b.binCode}
                </label>
              ))}
            </div>
            <button type="button" className="btn primary big" disabled={!toPrint.length} onClick={() => window.print()}>
              Print {toPrint.length} label{toPrint.length === 1 ? "" : "s"}
            </button>
          </section>

          <div className="label-sheet">
            {toPrint.map((b) => (
              <Label key={b.id} bin={b} size={size} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
