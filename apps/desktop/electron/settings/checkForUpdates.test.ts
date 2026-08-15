import { describe, expect, it } from "bun:test";
import { checkForUpdates, isNewerVersion } from "./checkForUpdates";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("isNewerVersion", () => {
  it("detects a larger numeric version", () => {
    expect(isNewerVersion("0.1.0", "0.0.3")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("1.2.1", "1.2")).toBe(true);
  });

  it("treats equal versions as not newer", () => {
    expect(isNewerVersion("0.0.3", "0.0.3")).toBe(false);
    expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
  });

  it("ignores a leading v", () => {
    expect(isNewerVersion("v0.1.0", "0.0.3")).toBe(true);
    expect(isNewerVersion("v0.0.3", "0.0.3")).toBe(false);
  });

  it("orders pre-release suffixes after the matching stable version", () => {
    expect(isNewerVersion("1.0.0", "1.0.0-beta.1")).toBe(true);
    expect(isNewerVersion("1.0.0-beta.1", "1.0.0")).toBe(false);
  });
});

describe("checkForUpdates", () => {
  it("reports a newer release with its version and URL", async () => {
    const result = await checkForUpdates("0.0.3", async () =>
      jsonResponse({ tag_name: "v0.1.0", html_url: "https://example.com/release" }),
    );

    expect(result).toEqual({
      hasUpdate: true,
      latestVersion: "0.1.0",
      releaseUrl: "https://example.com/release",
    });
  });

  it("reports no update when the latest tag matches the app version", async () => {
    const result = await checkForUpdates("0.0.3", async () =>
      jsonResponse({ tag_name: "0.0.3", html_url: "https://example.com/release" }),
    );

    expect(result.hasUpdate).toBe(false);
  });

  it("falls back to the releases page when html_url is missing", async () => {
    const result = await checkForUpdates("0.0.3", async () => jsonResponse({ tag_name: "0.1.0" }));

    expect(result).toEqual({
      hasUpdate: true,
      latestVersion: "0.1.0",
      releaseUrl: "https://github.com/Onion-L/carrent/releases",
    });
  });

  it("treats a failed request as no update", async () => {
    const result = await checkForUpdates("0.0.3", async () => jsonResponse({}, 404));
    expect(result).toEqual({ hasUpdate: false });
  });

  it("treats a missing tag as no update", async () => {
    const result = await checkForUpdates("0.0.3", async () => jsonResponse({ html_url: "x" }));
    expect(result).toEqual({ hasUpdate: false });
  });

  it("treats a thrown fetch as no update", async () => {
    const result = await checkForUpdates("0.0.3", async () => {
      throw new Error("offline");
    });
    expect(result).toEqual({ hasUpdate: false });
  });
});
