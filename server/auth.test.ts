import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memoryStore";
import { attemptLogin, hashPassword, sessionCookie, signSession, verifyPassword, verifySession, MAX_FAILURES } from "./auth";

const SECRET = "test-secret-at-least-32-characters-long!!";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });
  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
  it("accepts hashes made by the make-password script", async () => {
    // @ts-expect-error plain .mjs helper without type declarations
    const { makeHash } = await import("../scripts/hash.mjs");
    expect(await verifyPassword("from the script", await makeHash("from the script"))).toBe(true);
  });
  it("rejects a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("sessions", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  it("accepts a token it signed", () => {
    expect(verifySession(signSession(SECRET, now), SECRET, now + 1000)).toBe(true);
  });
  it("rejects tampered, foreign and expired tokens", () => {
    const t = signSession(SECRET, now);
    const [body, sig] = t.split(".");
    expect(verifySession(`${body}x.${sig}`, SECRET, now)).toBe(false);
    expect(verifySession(t, SECRET + "other", now)).toBe(false);
    expect(verifySession(t, SECRET, now + 181 * 24 * 3600 * 1000)).toBe(false);
    expect(verifySession("", SECRET, now)).toBe(false);
    expect(verifySession(undefined, SECRET, now)).toBe(false);
  });
  it("sets an HttpOnly, SameSite=Strict cookie, Secure over https", () => {
    const c = sessionCookie("tok", true);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/Path=\//);
    expect(sessionCookie("tok", false)).not.toMatch(/Secure/);
  });
});

describe("login attempts", () => {
  let store: MemoryStore;
  let clock: number;
  let hash: string;
  beforeEach(async () => {
    clock = Date.parse("2026-10-19T12:00:00Z");
    store = new MemoryStore(() => clock);
    hash = await hashPassword("right password");
  });
  const env = () => ({ passwordHash: hash, sessionSecret: SECRET });

  it("logs in with the right password", async () => {
    const r = await attemptLogin(store, env(), "right password", "1.2.3.4", clock);
    expect(r.ok).toBe(true);
    expect(r.ok && verifySession(r.token, SECRET, clock)).toBe(true);
  });

  it("locks out after repeated failures, even with the right password", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect((await attemptLogin(store, env(), "wrong", "1.2.3.4", clock)).ok).toBe(false);
    const r = await attemptLogin(store, env(), "right password", "1.2.3.4", clock);
    expect(r).toMatchObject({ ok: false, locked: true });
  });

  it("unlocks once the window passes", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await attemptLogin(store, env(), "wrong", "1.2.3.4", clock);
    clock += 16 * 60 * 1000;
    expect((await attemptLogin(store, env(), "right password", "1.2.3.4", clock)).ok).toBe(true);
  });

  it("counts failures across all addresses too, so changing IP doesn't help", async () => {
    for (let i = 0; i < MAX_FAILURES * 3; i++) await attemptLogin(store, env(), "wrong", `10.0.0.${i}`, clock);
    expect(await attemptLogin(store, env(), "right password", "5.5.5.5", clock)).toMatchObject({ ok: false, locked: true });
  });

  it("refuses to run without a configured password or secret", async () => {
    await expect(attemptLogin(store, { passwordHash: "", sessionSecret: SECRET }, "x", "1.1.1.1", clock)).rejects.toThrow(/not configured/i);
    await expect(attemptLogin(store, { passwordHash: hash, sessionSecret: "short" }, "x", "1.1.1.1", clock)).rejects.toThrow(/not configured/i);
  });
});
