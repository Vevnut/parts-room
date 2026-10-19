// Sign-in, sync status and conflicts, plus backup and restore.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { exportBackup, importBackup, type Backup } from "../db/repo";
import { ConfirmButton, Field, useToast } from "../ui";
import { useSync } from "../sync/SyncProvider";
import { ago } from "../sync/SyncBar";

const LAST_BACKUP = "lastBackupAt";

function SyncSection() {
  const s = useSync();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const labels = useLiveQuery(async () => {
    const out: Record<string, string> = {};
    for (const c of s.conflicts) {
      const row = await db.table(c.table).get(c.id);
      out[`${c.table}:${c.id}`] = c.table === "parts" ? `${row?.partId ?? ""} · ${row?.name ?? "Part"}` : c.table === "bins" ? `Bin ${row?.binCode ?? ""}` : c.id;
    }
    return out;
  }, [s.conflicts]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await s.signIn(password);
      setPassword("");
      toast("Signed in. Syncing this device.");
    } catch (err) {
      setError((err as Error).name === "OfflineError" ? "No connection. Try again when you have signal." : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Sync</h2>
      {s.phase === "signed-out" || s.phase === "checking" ? (
        <form onSubmit={submit} className="stack" noValidate>
          <p className="sub">Sign in on each device (phone and computer) to keep them in step. You stay signed in for 6 months.</p>
          <Field label="App password" error={error}>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button type="submit" className="btn primary big" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : (
        <div className="stack">
          <p className="sub">
            {s.phase === "offline"
              ? "Offline right now. Changes are saved on this device and sync when the connection is back."
              : s.phase === "error"
                ? s.message
                : `Last synced ${ago(s.lastSyncAt)}.`}{" "}
            {s.pending ? `${s.pending} change${s.pending === 1 ? "" : "s"} waiting.` : ""}
          </p>
          <div className="actions-row">
            <button type="button" className="btn primary" disabled={s.phase === "syncing"} onClick={() => void s.syncNow()}>
              {s.phase === "syncing" ? "Syncing…" : "Sync now"}
            </button>
            <ConfirmButton className="btn" confirmText="Tap again to sign out" onConfirm={() => void s.signOut()}>
              Sign out
            </ConfirmButton>
          </div>
        </div>
      )}

      {s.conflicts.length > 0 && (
        <div className="conflicts">
          <h3>Needs attention</h3>
          <ul className="list">
            {s.conflicts.map((c) => (
              <li key={`${c.table}:${c.id}`}>
                <Link to={c.table === "parts" ? `/parts/${c.id}` : c.table === "bins" ? `/bins/${c.id}/edit` : "/"} className="part-row">
                  <span className="part-main">
                    <span className="part-name">{labels?.[`${c.table}:${c.id}`] ?? "…"}</span>
                    <span className="part-meta">{c.reason}</span>
                  </span>
                  <span aria-hidden>›</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function More() {
  const toast = useToast();
  const lastBackup = useLiveQuery(async () => ((await db.settings.get(LAST_BACKUP))?.value as string | undefined) ?? null, []);
  const counts = useLiveQuery(async () => ({
    parts: await db.parts.filter((p) => !p.deletedAt).count(),
    bins: await db.bins.filter((b) => !b.deletedAt).count(),
  }), []);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [pending, setPending] = useState<{ file: string; data: Backup } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  async function download() {
    const backup = await exportBackup();
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parts-room-backup-${backup.exportedAt.slice(0, 16).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    await db.settings.put({ key: LAST_BACKUP, value: backup.exportedAt });
    toast("Backup downloaded");
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.app !== "parts-room") throw new Error("That file isn't a Parts Room backup.");
      setPending({ file: file.name, data });
    } catch (err) {
      setError(err instanceof SyntaxError ? "That file isn't a Parts Room backup." : (err as Error).message);
    }
  }

  async function restore() {
    if (!pending) return;
    try {
      const r = await importBackup(pending.data);
      toast(`Restored ${r.parts} parts and ${r.bins} bins`);
      setPending(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Sync &amp; backup</h1>
      </header>

      <SyncSection />

      <Link to="/systems" className="card row-between link-card">
        <span>
          <b>Systems</b>
          <span className="sub block">Add, rename, reorder or hide the systems you file parts under.</span>
        </span>
        <span aria-hidden>›</span>
      </Link>

      <section className="card">
        <h2>Download a backup</h2>
        <p className="sub">
          {counts ? `${counts.parts} parts and ${counts.bins} bins. ` : ""}
          {lastBackup ? `Last backup ${new Date(lastBackup).toLocaleString()}.` : "No backup yet."}
        </p>
        <button type="button" className="btn primary big" onClick={download}>
          Download backup
        </button>
      </section>

      <section className="card">
        <h2>Restore from a backup</h2>
        <p className="sub">Replaces everything on this device with the backup's contents, then syncs it as the newest version.</p>
        <label className="btn big file-btn">
          Choose backup file
          <input type="file" accept="application/json,.json" onChange={pick} />
        </label>
        {pending && (
          <div className="notice">
            <p>
              <b>{pending.file}</b>: {pending.data.parts.filter((p) => !p.deletedAt).length} parts, {pending.data.bins.filter((b) => !b.deletedAt).length} bins, saved{" "}
              {new Date(pending.data.exportedAt).toLocaleString()}.
            </p>
            <div className="actions-row">
              <button type="button" className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <ConfirmButton className="btn danger" confirmText="Tap again to replace all data" onConfirm={restore}>
                Restore this backup
              </ConfirmButton>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>Storage</h2>
        <p className="sub">
          {persisted === true
            ? "This browser has agreed to keep the app's data."
            : "This browser may clear the app's data if the device runs low on space. Add the app to your home screen and stay signed in to sync so nothing is lost."}
        </p>
      </section>
    </div>
  );
}
