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
    const relaxed = html.replace(
      "connect-src 'self' blob:;",
      "connect-src 'self' blob: ws://localhost:* http://localhost:*;",
    );
    if (relaxed === html) {
      console.warn("[relax-csp-for-dev-server] CSP literal not found; HMR may be blocked.");
    }
    return relaxed;
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
    plugins: [externalizeDepsPlugin({ exclude: ["@carrent/core"] })],
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
