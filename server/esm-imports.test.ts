// Vercel runs api/ as plain Node ES modules, which need explicit ".js" on relative imports.
// Vite and Vitest resolve imports without it, so only this test catches a missing one before deploy.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const dirs = ["api", "server", "src/domain"];

describe("server-side imports", () => {
  it("use explicit .js extensions on every relative import", () => {
    const bad: string[] = [];
    for (const dir of dirs) {
      for (const file of readdirSync(join(root, dir)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
        const src = readFileSync(join(root, dir, file), "utf8");
        for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
          if (!/\.(js|mjs|json)$/.test(m[1])) bad.push(`${dir}/${file}: ${m[1]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
