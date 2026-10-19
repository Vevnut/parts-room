// Keeps this device in sync in the background: after local edits (short delay), when the
// connection comes back, when the app is reopened, and once a minute while it's open.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db/db";
import { syncOnce, syncStatus, type SyncStatus } from "./engine";
import { NotSignedInError, OfflineError, ServerError, getSession, httpRemote, signIn as apiSignIn, signOut as apiSignOut } from "./client";

export type Phase = "checking" | "signed-out" | "offline" | "syncing" | "idle" | "error";

interface SyncCtx extends SyncStatus {
  phase: Phase;
  message: string;
  syncNow: () => Promise<void>;
  signIn: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const empty: SyncStatus = { pending: 0, photosPending: 0, conflicts: [], lastSyncAt: null };
const Ctx = createContext<SyncCtx>({ ...empty, phase: "checking", message: "", syncNow: async () => {}, signIn: async () => {}, signOut: async () => {} });
export const useSync = () => useContext(Ctx);

const EDIT_DELAY_MS = 2000;
const POLL_MS = 60_000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const status = useLiveQuery(() => syncStatus(db), [], empty);
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");
  const signedIn = useRef<boolean | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const fail = useCallback((e: unknown) => {
    if (e instanceof NotSignedInError) {
      signedIn.current = false;
      setPhase("signed-out");
    } else if (e instanceof OfflineError) {
      setPhase("offline");
    } else {
      setPhase("error");
      setMessage(e instanceof ServerError ? e.message : "Sync failed. It will try again shortly.");
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (running.current) {
      again.current = true; // one more pass after the current one, to pick up newer edits
      return running.current;
    }
    const run = (async () => {
      try {
        if (signedIn.current !== true) {
          signedIn.current = await getSession();
          if (!signedIn.current) return setPhase("signed-out");
        }
        do {
          again.current = false;
          setPhase("syncing");
          await syncOnce(httpRemote, db);
        } while (again.current);
        setPhase("idle");
        setMessage("");
      } catch (e) {
        fail(e);
      } finally {
        running.current = null;
      }
    })();
    running.current = run;
    return run;
  }, [fail]);

  // First check, reconnects, reopening the app, and a slow poll.
  useEffect(() => {
    void syncNow();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    const onOnline = () => void syncNow();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(onVisible, POLL_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
    };
  }, [syncNow]);

  // Local edits: sync shortly after the last one.
  useEffect(() => {
    if ((!status.pending && !status.photosPending) || signedIn.current === false) return;
    const t = window.setTimeout(() => void syncNow(), EDIT_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [status.pending, status.photosPending, syncNow]);

  const signIn = useCallback(
    async (password: string) => {
      await apiSignIn(password);
      signedIn.current = true;
      await syncNow();
    },
    [syncNow],
  );

  const signOut = useCallback(async () => {
    await apiSignOut();
    signedIn.current = false;
    setPhase("signed-out");
  }, []);

  return <Ctx.Provider value={{ ...status, phase, message, syncNow, signIn, signOut }}>{children}</Ctx.Provider>;
}
