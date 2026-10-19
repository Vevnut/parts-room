// Shared hooks and small controls. Sized for gloved thumbs: every tap target is >= 52px.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db/db";
import { clearDraft, loadDraft, saveDraft } from "./db/repo";
import { placementOf, statusOf, type Part, type Placement, type Status } from "./domain/rules";

// ---- data hooks ----
export const useParts = () => useLiveQuery(() => db.parts.filter((p) => !p.deletedAt).toArray(), []);
export const useBins = () =>
  useLiveQuery(async () => (await db.bins.filter((b) => !b.deletedAt).toArray()).sort((a, b) => a.binCode.localeCompare(b.binCode, undefined, { numeric: true })), []);
export const useSystems = () => useLiveQuery(() => db.systems.orderBy("sortOrder").toArray(), []);

// ---- formatting ----
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const fmtMoney = (n: number) => money.format(n);
export const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));
export const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time

export function parseNum(s: string): number | null {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

// ---- toast ----
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast" role="status" aria-live="polite" hidden={!msg}>
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---- unsaved-form drafts: survive a reload, a dead battery or a closed tab ----
export function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const pristine = useRef(JSON.stringify(initial));

  useEffect(() => {
    let live = true;
    loadDraft<T>(key).then((d) => {
      if (!live) return;
      if (d && JSON.stringify(d) !== pristine.current) {
        setValue(d);
        setRestored(true);
      }
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => {
      if (JSON.stringify(value) === pristine.current) void clearDraft(key);
      else void saveDraft(key, value);
    }, 250);
    return () => window.clearTimeout(t);
  }, [key, value, ready]);

  const reset = useCallback(
    (next: T) => {
      pristine.current = JSON.stringify(next);
      setValue(next);
      setRestored(false);
      void clearDraft(key);
    },
    [key],
  );
  return { value, setValue, ready, restored, reset };
}

// ---- controls ----
export function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const [text, setText] = useState(fmtQty(value));
  useEffect(() => {
    setText(fmtQty(value));
  }, [value]);
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="step" aria-label={`Decrease ${label}`} onClick={() => onChange(Math.max(0, Math.round((value - 1) * 100) / 100))}>
        −
      </button>
      <input
        inputMode="decimal"
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseNum(e.target.value);
          if (n != null && !Number.isNaN(n) && n >= 0) onChange(n);
        }}
        onBlur={() => setText(fmtQty(value))}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" className="step" aria-label={`Increase ${label}`} onClick={() => onChange(Math.round((value + 1) * 100) / 100)}>
        +
      </button>
    </div>
  );
}

export function Choice<T extends string>({
  options,
  value,
  onChange,
  label,
  cols = 2,
  allowNone,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T | null) => void;
  label: string;
  cols?: number;
  allowNone?: boolean;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(allowNone && value === o.value ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className={`field${error ? " has-error" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <small className="hint">{hint}</small>}
      {error && <small className="error">{error}</small>}
    </label>
  );
}

const statusClass: Record<Status, string> = { OK: "ok", Reorder: "warn", "Out of stock": "bad", "Not kept": "muted" };
const placementClass: Record<Placement, string> = { "Needs bin": "warn", Staged: "info", "Put away": "ok", "n/a": "muted" };

export function StatusChip({ part }: { part: Part }) {
  const s = statusOf(part);
  return <span className={`chip ${statusClass[s]}`}>{s}</span>;
}
export function PlacementChip({ part }: { part: Part }) {
  const p = placementOf(part);
  if (p === "n/a") return null;
  return <span className={`chip ${placementClass[p]}`}>{p}</span>;
}
export function BinLabel({ code }: { code: string }) {
  return <span className="binlabel">{code}</span>;
}

// Two taps to confirm, since the app frame can't rely on confirm() dialogs.
export function ConfirmButton({ children, confirmText, onConfirm, className = "" }: { children: ReactNode; confirmText: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={`${className} ${armed ? "armed" : ""}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? confirmText : children}
    </button>
  );
}
