/// <reference types="vitest" />
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Runs the Vercel functions in api/ inside the dev server, so `npm run dev` works end to end.
// Server-only env vars (DATABASE_URL, APP_PASSWORD_HASH, SESSION_SECRET) come from .env.local
// and are never exposed to the browser bundle (only VITE_* vars are).
function devApi(): Plugin {
  return {
    name: "dev-api",
    apply: "serve",
    configureServer(server) {
      const env = loadEnv("development", process.cwd(), "");
      for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v;
      server.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/api\/([a-z-]+)(?:\?.*)?$/);
        if (!m) return next();
        const file = resolve(process.cwd(), "api", `${m[1]}.ts`);
        if (!existsSync(file)) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: "Not found." }));
        }
        try {
          const mod = await server.ssrLoadModule(file);
          await mod.default(req, res);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    devApi(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Parts Room",
        short_name: "Parts Room",
        description: "Parts inventory by bin",
        theme_color: "#0b2a3f",
        background_color: "#eef2f4",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: { navigateFallback: "/index.html", navigateFallbackDenylist: [/^\/api\//] },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
