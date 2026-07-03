import { describe, expect, it } from "bun:test";

import { lightboxToolbarStyle } from "./ImageAttachmentLightbox";

describe("ImageAttachmentLightbox", () => {
  it("keeps toolbar controls below the native titlebar hit area", () => {
    expect(lightboxToolbarStyle.paddingTop).toBe("env(titlebar-area-height, 38px)");
  });
});
