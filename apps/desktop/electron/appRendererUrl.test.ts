import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  denyAppRendererWindowOpen,
  guardAppRendererNavigation,
  isAppRendererUrl,
} from "./appRendererUrl";

const __dirname = dirname(fileURLToPath(import.meta.url));

const originalDevServerUrl = process.env.ELECTRON_RENDERER_URL;

type NavigationListener = (event: { preventDefault: () => void }, url: string) => void;

function restoreDevServerUrl() {
  if (originalDevServerUrl === undefined) {
    delete process.env.ELECTRON_RENDERER_URL;
  } else {
    process.env.ELECTRON_RENDERER_URL = originalDevServerUrl;
  }
}

beforeEach(() => {
  delete process.env.ELECTRON_RENDERER_URL;
});

afterEach(restoreDevServerUrl);

describe("isAppRendererUrl (dev)", () => {
  beforeEach(() => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173";
  });

  it("accepts the dev-server page with query params", () => {
    expect(isAppRendererUrl("http://localhost:5173/?browserWindow=1")).toBe(true);
  });

  it("rejects a different port", () => {
    expect(isAppRendererUrl("http://localhost:5174/")).toBe(false);
  });

  it("rejects a different host", () => {
    expect(isAppRendererUrl("http://evil.example/")).toBe(false);
  });

  it("rejects a different path on the dev-server origin", () => {
    expect(isAppRendererUrl("http://localhost:5173/something")).toBe(false);
  });

  it("rejects file URLs while the dev server is set", () => {
    const rendererIndex = pathToFileURL(join(__dirname, "..", "renderer", "index.html")).href;
    expect(isAppRendererUrl(rendererIndex)).toBe(false);
  });
});

describe("isAppRendererUrl (prod)", () => {
  it("accepts the packaged bundle inside the renderer directory", () => {
    const rendererDir = pathToFileURL(join(__dirname, "..", "renderer") + "/").href;
    expect(isAppRendererUrl(`${rendererDir}index.html?browserWindow=1`)).toBe(true);
  });

  it("rejects file URLs outside the renderer directory", () => {
    expect(isAppRendererUrl("file:///Applications/Calculator.app")).toBe(false);
  });

  it("rejects a sibling directory whose name merely prefixes the renderer directory", () => {
    const siblingDir = pathToFileURL(join(__dirname, "..", "renderer-evil") + "/").href;
    expect(isAppRendererUrl(`${siblingDir}index.html`)).toBe(false);
  });

  it("rejects dev-server origins when no dev server is configured", () => {
    expect(isAppRendererUrl("http://localhost:5173/")).toBe(false);
  });
});

describe("isAppRendererUrl (garbage input)", () => {
  it("rejects non-URL strings", () => {
    expect(isAppRendererUrl("not a url")).toBe(false);
  });
});

describe("privileged renderer WebContents guards", () => {
  beforeEach(() => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173";
  });

  it("blocks non-app navigation starts and server redirects", () => {
    const listeners = new Map<string, NavigationListener>();
    const contents = {
      on(event: "will-navigate" | "will-redirect", listener: NavigationListener) {
        listeners.set(event, listener);
      },
    };
    guardAppRendererNavigation(contents);

    expect([...listeners.keys()]).toEqual(["will-navigate", "will-redirect"]);
    for (const eventName of ["will-navigate", "will-redirect"] as const) {
      let prevented = false;
      listeners.get(eventName)?.(
        { preventDefault: () => (prevented = true) },
        "https://evil.example",
      );
      expect(prevented).toBe(true);
    }
  });

  it("allows navigation and redirects that stay on the app renderer page", () => {
    const listeners = new Map<string, NavigationListener>();
    const contents = {
      on(event: "will-navigate" | "will-redirect", listener: NavigationListener) {
        listeners.set(event, listener);
      },
    };
    guardAppRendererNavigation(contents);

    for (const eventName of ["will-navigate", "will-redirect"] as const) {
      let prevented = false;
      listeners.get(eventName)?.(
        { preventDefault: () => (prevented = true) },
        "http://localhost:5173/?window=1",
      );
      expect(prevented).toBe(false);
    }
  });

  it("denies every renderer-created child window including about:blank", () => {
    let handler: ((details: { url: string }) => { action: "deny" }) | undefined;
    denyAppRendererWindowOpen({
      setWindowOpenHandler(nextHandler) {
        handler = nextHandler;
      },
    });

    expect(handler?.({ url: "about:blank" })).toEqual({ action: "deny" });
    expect(handler?.({ url: "https://evil.example" })).toEqual({ action: "deny" });
  });
});
