// Single-owner login: one password (stored only as a scrypt hash in an env var) and a
// signed, HttpOnly session cookie. Failed attempts are rate-limited per address and overall.
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Store } from "./store.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;

export const COOKIE = "pr_session";
export const SESSION_DAYS = 180;
export const MAX_FAILURES = 10; // per address per window; 3x that across all addresses
export const WINDOW_MS = 15 * 60 * 1000;

const b64u = (b: Buffer) => b.toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${b64u(salt)}$${b64u(key)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, hash] = parts;
  try {
    const expected = Buffer.from(hash, "base64url");
    const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return expected.length > 0 && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

const sign = (body: string, secret: string) => b64u(createHmac("sha256", secret).update(body).digest());

export function signSession(secret: string, now: number): string {
  const body = b64u(Buffer.from(JSON.stringify({ exp: now + SESSION_DAYS * 86_400_000 })));
  return `${body}.${sign(body, secret)}`;
}

export function verifySession(token: string | undefined, secret: string, now: number): boolean {
  if (!token || !token.includes(".")) return false;
  const [body, sig] = token.split(".", 2);
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(sig ?? "");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}${secure ? "; Secure" : ""}`;
}
export function clearedCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}
export function readCookie(header: string | undefined, name = COOKIE): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export interface AuthEnv {
  passwordHash: string;
  sessionSecret: string;
}

export function assertConfigured(env: AuthEnv) {
  if (!env.passwordHash?.startsWith("scrypt$") || !env.sessionSecret || env.sessionSecret.length < 32) {
    throw new Error("Login is not configured: set APP_PASSWORD_HASH and SESSION_SECRET (32+ characters).");
  }
}

export type LoginResult = { ok: true; token: string } | { ok: false; locked: boolean };

export async function attemptLogin(store: Store, env: AuthEnv, password: string, ip: string, now: number): Promise<LoginResult> {
  assertConfigured(env);
  const since = now - WINDOW_MS;
  const ipKey = `ip:${ip}`;
  const [ipFails, allFails] = await Promise.all([store.countFailedLogins(ipKey, since), store.countFailedLogins("all", since)]);
  if (ipFails >= MAX_FAILURES || allFails >= MAX_FAILURES * 3) return { ok: false, locked: true };

  if (await verifyPassword(String(password ?? ""), env.passwordHash)) {
    await store.clearFailedLogins(ipKey);
    return { ok: true, token: signSession(env.sessionSecret, now) };
  }
  await Promise.all([store.recordFailedLogin(ipKey, now), store.recordFailedLogin("all", now)]);
  return { ok: false, locked: false };
}
