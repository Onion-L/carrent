import { describe, expect, it } from "bun:test";

import { shouldSubmitComposerOnKeyDown } from "./Composer";

describe("shouldSubmitComposerOnKeyDown", () => {
  it("submits on plain Enter", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "Enter",
        shiftKey: false,
        nativeEvent: {},
      }),
    ).toBe(true);
  });

  it("does not submit on Shift+Enter", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "Enter",
        shiftKey: true,
        nativeEvent: {},
      }),
    ).toBe(false);
  });

  it("does not submit while IME composition is active", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
      }),
    ).toBe(false);
  });

  it("does not submit IME keydown events reported as keyCode 229", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "Enter",
        shiftKey: false,
        keyCode: 229,
        nativeEvent: {},
      }),
    ).toBe(false);
  });

  it("does not submit non-Enter keys", () => {
    expect(
      shouldSubmitComposerOnKeyDown({
        key: "a",
        shiftKey: false,
        nativeEvent: {},
      }),
    ).toBe(false);
  });
});
