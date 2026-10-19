// Shared plumbing for the /api functions (Vercel Node runtime, and the Vite dev server locally).
import type { IncomingMessage, ServerResponse } from "node:http";
import { readCookie, verifySession, type AuthEnv } from "./auth";
import { PgStore } from "./pgStore";
import { HttpError } from "./syncHandler";
import type { Store } from "./store";

export type Req = IncomingMessage & { body?: unknown };
export type Res = ServerResponse;

const MAX_BODY = 2_000_000;

export async function readJson(req: Req): Promise<unknown> {
  if (req.body !== undefined && req.body !== null && typeof req.body !== "string") return req.body; // Vercel pre-parses
  const ct = String(req.headers["content-type"] ?? "");
  if (!ct.startsWith("application/json")) throw new HttpError(415, "Send JSON.");
  let raw = typeof req.body === "string" ? req.body : "";
  if (!raw) {
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) throw new HttpError(413, "Request too large.");
    }
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

export function send(res: Res, status: number, data: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export const isHttps = (req: Req) => String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";

export function clientIp(req: Req): string {
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real) return real;
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "unknown";
}

export const authEnv = (): AuthEnv => ({
  passwordHash: process.env.APP_PASSWORD_HASH ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "",
});

export function isSignedIn(req: Req): boolean {
  const { sessionSecret } = authEnv();
  return !!sessionSecret && verifySession(readCookie(req.headers.cookie), sessionSecret, Date.now());
}

let store: Store | null = null;
/** Tests swap in the in-memory store. */
export function setStore(s: Store | null) {
  store = s;
}
export function getStore(): Store {
  if (!store) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new HttpError(503, "The database isn't set up yet (DATABASE_URL is missing).");
    store = new PgStore(url);
  }
  return store;
}

// Rejects cross-site POSTs. The cookie is SameSite=Strict as well; this is a second lock.
function sameOrigin(req: Req): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches from older browsers may omit it
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function route(methods: string[], fn: (req: Req, res: Res) => Promise<void>) {
  return async (req: Req, res: Res) => {
    try {
      if (!methods.includes(req.method ?? "")) throw new HttpError(405, "Method not allowed.");
      if (req.method !== "GET" && !sameOrigin(req)) throw new HttpError(403, "Cross-site request refused.");
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: "Something went wrong on the server." });
    }
  };
}
