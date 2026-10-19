// Asks for the app password (typed hidden) and prints the two values to put in Vercel's
// environment variables and .env.local. The password itself is never stored or printed.
// Usage: npm run make-password
import { createInterface } from "node:readline";
import { makeHash, makeSecret } from "./hash.mjs";

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const pw = await askHidden("New app password (12+ characters): ");
if (pw.length < 12) {
  console.error("Use at least 12 characters. Nothing was created.");
  process.exit(1);
}
const again = await askHidden("Type it again: ");
if (again !== pw) {
  console.error("Those didn't match. Nothing was created.");
  process.exit(1);
}
console.log("\nAdd these two environment variables (Vercel project settings, and .env.local for local testing):\n");
console.log(`APP_PASSWORD_HASH=${await makeHash(pw)}`);
console.log(`SESSION_SECRET=${makeSecret()}`);
