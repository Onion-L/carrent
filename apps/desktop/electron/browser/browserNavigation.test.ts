import { describe, expect, it } from "bun:test";
import { isBrowserUrl, isHttpOrHttpsUrl, resolveBrowserInput } from "./browserNavigation";

describe("resolveBrowserInput", () => {
  it("adds http to loopback development addresses", () => {
    expect(resolveBrowserInput("localhost:5173/app", "google")).toBe("http://localhost:5173/app");
    expect(resolveBrowserInput("[::1]:3000", "google")).toBe("http://[::1]:3000");
  });

  it("adds https to ordinary host names", () => {
    expect(resolveBrowserInput("example.com/docs", "google")).toBe("https://example.com/docs");
  });

  it("uses the selected search engine for non-URL input", () => {
    expect(resolveBrowserInput("component state", "duckduckgo")).toBe(
      "https://duckduckgo.com/?q=component%20state",
    );
  });
});

describe("isBrowserUrl", () => {
  it("allows only blank and HTTP(S) pages", () => {
    expect(isBrowserUrl("about:blank")).toBe(true);
    expect(isBrowserUrl("https://example.com")).toBe(true);
    expect(isBrowserUrl("file:///tmp/a.html")).toBe(false);
    expect(isBrowserUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("isHttpOrHttpsUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpOrHttpsUrl("https://example.com/a")).toBe(true);
    expect(isHttpOrHttpsUrl("http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects blank, local, and scripting schemes", () => {
    expect(isHttpOrHttpsUrl("about:blank")).toBe(false);
    expect(isHttpOrHttpsUrl("file:///tmp/x")).toBe(false);
    expect(isHttpOrHttpsUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects non-URL and empty input", () => {
    expect(isHttpOrHttpsUrl("not a url")).toBe(false);
    expect(isHttpOrHttpsUrl("")).toBe(false);
  });
});
