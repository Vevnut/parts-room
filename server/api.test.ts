// The real /api handlers end to end, with fake requests and the in-memory store.
import { Readable } from "node:stream";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import login from "../api/login.js";
import logout from "../api/logout.js";
import session from "../api/session.js";
import sync from "../api/sync.js";
import { hashPassword } from "./auth.js";
import { setStore, type Req, type Res } from "./http.js";
import { MemoryStore } from "./memoryStore.js";

interface Call {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string;
  contentType?: string;
}
async function call(handler: (req: Req, res: Res) => Promise<void>, c: Call = {}) {
  const raw = c.body === undefined ? "" : JSON.stringify(c.body);
  const req = Readable.from(raw ? [raw] : []) as unknown as Req;
  Object.assign(req, {
    method: c.method ?? "POST",
    headers: {
      host: "parts.example.com",
      "content-type": c.contentType ?? "application/json",
      "x-forwarded-proto": "https",
      "x-real-ip": "9.9.9.9",
      ...(c.cookie ? { cookie: c.cookie } : {}),
      ...(c.origin ? { origin: c.origin } : {}),
    },
  });
  const out = { status: 0, headers: {} as Record<string, string>, body: undefined as any };
  const res = {
    set statusCode(v: number) {
      out.status = v;
    },
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
    end(s: string) {
      out.body = JSON.parse(s);
    },
  } as unknown as Res;
  await handler(req, res);
  return out;
}

beforeAll(async () => {
  process.env.APP_PASSWORD_HASH = await hashPassword("test password");
  process.env.SESSION_SECRET = "s".repeat(40);
});
beforeEach(() => setStore(new MemoryStore()));
afterEach(() => setStore(null));

const signIn = async () => {
  const r = await call(login, { body: { password: "test password" } });
  return r.headers["set-cookie"].split(";")[0];
};
const systemRow = { id: "other", name: "Other", sortOrder: 13, active: true };

describe("api", () => {
  it("signs in with the right password and sets a secure session cookie", async () => {
    const r = await call(login, { body: { password: "test password" } });
    expect(r.status).toBe(200);
    expect(r.headers["set-cookie"]).toMatch(/pr_session=.+HttpOnly; SameSite=Strict.*Secure/);
    const s = await call(session, { method: "GET", cookie: r.headers["set-cookie"].split(";")[0] });
    expect(s.body).toEqual({ signedIn: true });
  });

  it("refuses a wrong password", async () => {
    const r = await call(login, { body: { password: "nope" } });
    expect(r.status).toBe(401);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses sync without a valid session", async () => {
    expect((await call(sync, { body: { push: [], cursors: {} } })).status).toBe(401);
    expect((await call(sync, { body: { push: [], cursors: {} }, cookie: "pr_session=forged.token" })).status).toBe(401);
  });

  it("syncs once signed in", async () => {
    const cookie = await signIn();
    const r = await call(sync, { cookie, body: { push: [{ table: "systems", row: systemRow }], cursors: {} } });
    expect(r.status).toBe(200);
    expect(r.body.results[0].status).toBe("ok");
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("refuses cross-site posts, wrong methods and non-JSON bodies", async () => {
    const cookie = await signIn();
    expect((await call(sync, { cookie, body: {}, origin: "https://evil.example" })).status).toBe(403);
    expect((await call(sync, { cookie, method: "GET" })).status).toBe(405);
    expect((await call(sync, { cookie, body: {}, contentType: "text/plain" })).status).toBe(415);
  });

  it("signs out by clearing the cookie", async () => {
    const r = await call(logout, {});
    expect(r.headers["set-cookie"]).toMatch(/Max-Age=0/);
  });

  it("never sends server internals back on unexpected errors", async () => {
    const cookie = await signIn();
    const broken = new MemoryStore();
    broken.upsert = async () => {
      throw new Error("connection to postgres://user:secret@host failed");
    };
    setStore(broken);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call(sync, { cookie, body: { push: [{ table: "systems", row: systemRow }], cursors: {} } });
    quiet.mockRestore();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/postgres|secret/);
  });
});
