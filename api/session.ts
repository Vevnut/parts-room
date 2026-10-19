import { isSignedIn, route, send } from "../server/http.js";

export default route(["GET"], async (req, res) => {
  send(res, 200, { signedIn: isSignedIn(req) });
});
