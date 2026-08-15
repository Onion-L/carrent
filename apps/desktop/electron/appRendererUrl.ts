import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// True when `url` points at Carrent's own renderer bundle: the Vite dev
// server in development (ELECTRON_RENDERER_URL), the packaged file://
// bundle in production. Privileged windows must never navigate their
// top-level frame anywhere else — the preload bridge (terminal, shell,
// clipboard) must not be handed to a remote origin.
export function isAppRendererUrl(url: string): boolean {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  try {
    const parsed = new URL(url);
    if (devServerUrl) {
      // Dev: trust only the exact dev-server page (origin AND pathname),
      // not every path the dev server can serve — proxies or future routes
      // must not become trusted pages implicitly.
      const devServer = new URL(devServerUrl);
      return parsed.origin === devServer.origin && parsed.pathname === devServer.pathname;
    }
    if (parsed.protocol !== "file:") {
      return false;
    }
    const rendererDirUrl = pathToFileURL(join(__dirname, "..", "renderer") + "/");
    return parsed.href.startsWith(rendererDirUrl.href);
  } catch {
    return false;
  }
}
