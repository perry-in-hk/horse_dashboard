import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Vite dev-server proxy target (server-side). In Docker Compose use http://backend:4000. */
const devProxyTarget = (process.env.DEV_PROXY_TARGET ?? "http://localhost:4000").replace(/\/$/, "");
const devProxyWsTarget = devProxyTarget.replace(/^http/i, "ws");

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Caddy forwards the browser Host (e.g. *.duckdns.org); Vite 8+ blocks unknown hosts by default.
    allowedHosts: true,
    proxy: {
      "/api": { target: devProxyTarget, changeOrigin: true },
      "/health": { target: devProxyTarget, changeOrigin: true },
      "/ws": { target: devProxyWsTarget, ws: true, changeOrigin: true },
    },
  },
});
