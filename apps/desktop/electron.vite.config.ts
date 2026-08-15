import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Dev-only: allow the Vite dev server and its HMR websocket, which the
// production CSP deliberately omits. `apply: "serve"` means this never
// runs during `electron-vite build`.
const relaxCspForDevServer = {
  name: "relax-csp-for-dev-server",
  apply: "serve" as const,
  transformIndexHtml(html: string) {
    return html.replace(
      "connect-src 'self';",
      "connect-src 'self' ws://localhost:* http://localhost:*;",
    );
  },
};

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/main.ts"),
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "electron/preload.ts"),
          browserMenuOverlay: resolve(__dirname, "electron/browserMenuOverlayPreload.ts"),
        },
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), relaxCspForDevServer],
  },
});
