import { describe, expect, it } from "bun:test";

import { getCascadingPanelPosition, shouldSubmitComposerOnKeyDown } from "./Composer";

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

describe("getCascadingPanelPosition", () => {
  const panelSize = { width: 240, height: 180 };

  it("places the panel on the right when there is enough space", () => {
    expect(
      getCascadingPanelPosition(
        { left: 100, top: 80, right: 260, bottom: 112, width: 160, height: 32 },
        { width: 800, height: 600 },
        panelSize,
      ),
    ).toEqual({
      left: 268,
      top: 80,
      width: 240,
      side: "right",
    });
  });

  it("places the panel on the left when the right side is too narrow", () => {
    expect(
      getCascadingPanelPosition(
        { left: 520, top: 80, right: 680, bottom: 112, width: 160, height: 32 },
        { width: 700, height: 600 },
        panelSize,
      ),
    ).toEqual({
      left: 272,
      top: 80,
      width: 240,
      side: "left",
    });
  });

  it("keeps the panel inside the viewport when both sides are narrow", () => {
    const result = getCascadingPanelPosition(
      { left: 95, top: 80, right: 205, bottom: 112, width: 110, height: 32 },
      { width: 300, height: 600 },
      { width: 360, height: 180 },
    );

    expect(result).toEqual({
      left: 8,
      top: 80,
      width: 284,
      side: "center",
    });
    expect(result.left >= 8).toBe(true);
    expect(result.left + result.width <= 292).toBe(true);
  });

  it("corrects vertical overflow at the bottom and top", () => {
    expect(
      getCascadingPanelPosition(
        { left: 100, top: 520, right: 260, bottom: 552, width: 160, height: 32 },
        { width: 800, height: 600 },
        panelSize,
      ).top,
    ).toBe(412);

    expect(
      getCascadingPanelPosition(
        { left: 100, top: -20, right: 260, bottom: 12, width: 160, height: 32 },
        { width: 800, height: 600 },
        panelSize,
      ).top,
    ).toBe(8);
  });
});
