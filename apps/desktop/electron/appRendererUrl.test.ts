import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isAppRendererUrl } from "./appRendererUrl";

const __dirname = dirname(fileURLToPath(import.meta.url));

const originalDevServerUrl = process.env.ELECTRON_RENDERER_URL;

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
