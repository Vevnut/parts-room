// Talks to the /api functions. Every call is same-origin; the session lives in an HttpOnly cookie
// the page can't read.
import type { Remote, SyncRequest } from "./engine";
import type { SyncResponse } from "../../server/syncHandler";

export class OfflineError extends Error {
  constructor() {
    super("No connection.");
    this.name = "OfflineError";
  }
}
export class NotSignedInError extends Error {
  constructor() {
    super("Sign in to sync.");
    this.name = "NotSignedInError";
  }
}
export class ServerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ServerError";
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new OfflineError();
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401 && path !== "/api/login") throw new NotSignedInError();
  if (!res.ok) throw new ServerError(res.status, data.error ?? `The server answered ${res.status}.`);
  return data;
}

export const httpRemote: Remote = {
  sync: (body: SyncRequest) => api<SyncResponse>("/api/sync", body),
};

export async function getSession(): Promise<boolean> {
  return (await api<{ signedIn: boolean }>("/api/session")).signedIn;
}
export async function signIn(password: string): Promise<void> {
  await api("/api/login", { password });
}
export async function signOut(): Promise<void> {
  await api("/api/logout", {});
}
