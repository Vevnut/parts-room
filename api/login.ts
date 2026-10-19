import { attemptLogin, sessionCookie } from "../server/auth";
import { authEnv, clientIp, getStore, isHttps, readJson, route, send } from "../server/http";
import { HttpError } from "../server/syncHandler";

export default route(["POST"], async (req, res) => {
  const body = (await readJson(req)) as { password?: unknown };
  const password = typeof body?.password === "string" ? body.password.slice(0, 200) : "";
  let result;
  try {
    result = await attemptLogin(getStore(), authEnv(), password, clientIp(req), Date.now());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (/not configured/i.test((e as Error).message)) throw new HttpError(503, "Sign-in isn't set up on the server yet.");
    throw e;
  }
  if (result.ok) return send(res, 200, { signedIn: true }, { "Set-Cookie": sessionCookie(result.token, isHttps(req)) });
  if (result.locked) return send(res, 429, { error: "Too many wrong passwords. Wait 15 minutes and try again." });
  send(res, 401, { error: "That password isn't right." });
});
