import { clearedCookie } from "../server/auth.js";
import { isHttps, route, send } from "../server/http.js";

export default route(["POST"], async (req, res) => {
  send(res, 200, { signedIn: false }, { "Set-Cookie": clearedCookie(isHttps(req)) });
});
