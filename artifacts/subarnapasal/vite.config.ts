import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Defaults keep local/Vercel builds working; override via env when needed.
const rawPort = process.env.PORT || "19951";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || "/";

/**
 * Customer request link: /order/<code> is the address the shop shares, and it
 * serves the standalone request page (public/customer.html). In production the
 * web server does this (Laravel's routes/web.php, or a host rewrite); this
 * keeps the same address working under `pnpm dev`.
 */
function rewriteOrderUrl(req: any, _res: any, next: any) {
  const url = String(req.url || "");
  const match = url.match(/^\/order(?:\/([A-Za-z0-9]{0,64}))?\/?(?:\?(.*))?$/);
  if (match) {
    const code = match[1] || "";
    const rest = match[2] ? `&${match[2]}` : "";
    req.url = code ? `/customer.html?shop=${code}${rest}` : `/customer.html${match[2] ? `?${match[2]}` : ""}`;
  }
  next();
}

const customerLinkRoute = {
  name: "subarnapasal-customer-link-route",
  configureServer(server: any) {
    server.middlewares.use(rewriteOrderUrl);
  },
  configurePreviewServer(server: any) {
    server.middlewares.use(rewriteOrderUrl);
  },
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    customerLinkRoute,
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
