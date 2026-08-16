import { describe, expect, it } from "bun:test";

import { createFaviconResolver } from "./favicon";

const fakeSession = null as never;

describe("createFaviconResolver", () => {
  it("converts an image payload to a data URL", async () => {
    const resolve = createFaviconResolver(async () => ({
      contentType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    }));

    expect(await resolve("https://example.com/favicon.ico", fakeSession)).toBe(
      "data:image/png;base64,AQID",
    );
  });

  it("strips content-type parameters from the data URL", async () => {
    const resolve = createFaviconResolver(async () => ({
      contentType: "image/svg+xml; charset=utf-8",
      bytes: new Uint8Array([1]),
    }));

    expect(await resolve("https://example.com/favicon.svg", fakeSession)).toBe(
      "data:image/svg+xml;base64,AQ==",
    );
  });

  it("returns null when the fetcher yields no payload or throws", async () => {
    const noPayload = createFaviconResolver(async () => null);
    expect(await noPayload("https://example.com/a.ico", fakeSession)).toBeNull();

    const throwing = createFaviconResolver(async () => {
      throw new Error("offline");
    });
    expect(await throwing("https://example.com/b.ico", fakeSession)).toBeNull();
  });

  it("caches resolved URLs so repeat favicons do not refetch", async () => {
    let fetches = 0;
    const resolve = createFaviconResolver(async () => {
      fetches += 1;
      return { contentType: "image/png", bytes: new Uint8Array([9]) };
    });

    const url = "https://example.com/favicon.ico";
    expect(await resolve(url, fakeSession)).toBe("data:image/png;base64,CQ==");
    expect(await resolve(url, fakeSession)).toBe("data:image/png;base64,CQ==");
    expect(fetches).toBe(1);
  });
});
