import { describe, expect, it } from "bun:test";
import { installLocalFontPermissionHandler } from "./fontPermissions";

describe("local font permissions", () => {
  it("allows local fonts only for the app renderer", () => {
    const previousDevUrl = process.env.ELECTRON_RENDERER_URL;
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173/";
    let handler:
      | ((contents: { getURL: () => string } | null, permission: string, origin: string) => boolean)
      | undefined;
    installLocalFontPermissionHandler({
      setPermissionCheckHandler: (next) => {
        handler = next;
      },
    });
    expect(
      handler?.(
        { getURL: () => "http://localhost:5173/" },
        "local-fonts",
        "http://localhost:5173/",
      ),
    ).toBe(true);
    expect(
      handler?.({ getURL: () => "https://example.com" }, "local-fonts", "https://example.com"),
    ).toBe(false);
    expect(handler?.(null, "notifications", "file://")).toBe(false);
    if (previousDevUrl === undefined) delete process.env.ELECTRON_RENDERER_URL;
    else process.env.ELECTRON_RENDERER_URL = previousDevUrl;
  });
});
