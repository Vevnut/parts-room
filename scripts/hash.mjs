// Same format as server/auth.ts hashPassword (checked by server/auth.test.ts).
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

export async function makeHash(password) {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export const makeSecret = () => randomBytes(48).toString("base64url");
