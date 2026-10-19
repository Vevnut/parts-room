import { getStore, isSignedIn, readJson, route, send } from "../server/http";
import { HttpError, handleSync } from "../server/syncHandler";

export default route(["POST"], async (req, res) => {
  if (!isSignedIn(req)) throw new HttpError(401, "Sign in to sync.");
  send(res, 200, await handleSync(getStore(), await readJson(req)));
});
