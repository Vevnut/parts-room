// One line at the top of every screen saying whether this device is in sync.
import { Link } from "react-router-dom";
import { useSync } from "./SyncProvider";

export function ago(iso: string | null): string {
  if (!iso) return "not yet";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "a minute ago";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return new Date(iso).toLocaleDateString();
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function SyncBar() {
  const s = useSync();
  if (s.conflicts.length)
    return (
      <Link to="/more" className="syncbar bad">
        {plural(s.conflicts.length, "item needs", "items need")} attention before it can sync ›
      </Link>
    );
  switch (s.phase) {
    case "checking":
      return <div className="syncbar muted">Checking sync…</div>;
    case "signed-out":
      return (
        <Link to="/more" className="syncbar muted">
          Not syncing{s.pending ? ` · ${plural(s.pending, "change", "changes")} only on this device` : ""} · Sign in ›
        </Link>
      );
    case "offline":
      return <div className="syncbar warn">Offline · {s.pending ? `${plural(s.pending, "change", "changes")} saved on this device` : "everything is saved on this device"}</div>;
    case "syncing":
      return <div className="syncbar info">Syncing…</div>;
    case "error":
      return (
        <button type="button" className="syncbar bad" onClick={() => void s.syncNow()}>
          {s.message || "Sync failed."} Tap to retry.
        </button>
      );
    default:
      return <div className="syncbar ok">{s.pending ? `${plural(s.pending, "change", "changes")} waiting to sync` : `✓ Synced ${ago(s.lastSyncAt)}`}</div>;
  }
}
