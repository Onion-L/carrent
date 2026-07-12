import { describe, expect, it } from "bun:test";
import {
  getFontSizeCssVariables,
  normalizeFontSize,
  parseFontSizeInput,
  ROOT_FONT_SIZE,
  stepFontSize,
} from "./fontSize";

describe("font size CSS variables", () => {
  it("preserves the current typography at the default size", () => {
    expect(ROOT_FONT_SIZE).toBe(14);
    expect(getFontSizeCssVariables(14)).toMatchObject({
      "--font-size-13": "13px",
      "--font-size-xs": "10.5px",
      "--line-height-5": "17.5px",
    });
  });

  it("scales typography without changing the root layout size", () => {
    expect(ROOT_FONT_SIZE).toBe(14);
    expect(getFontSizeCssVariables(16)).toMatchObject({
      "--font-size-13": "14.857px",
      "--font-size-xs": "12px",
      "--line-height-5": "20px",
    });
  });
});

describe("font size input", () => {
  it("accepts integers within the supported range", () => {
    expect(parseFontSizeInput("8")).toBe(8);
    expect(parseFontSizeInput("17")).toBe(17);
    expect(parseFontSizeInput("32")).toBe(32);
  });

  it("rejects non-integers and out-of-range values", () => {
    expect(parseFontSizeInput("")).toBe(null);
    expect(parseFontSizeInput("12.5")).toBe(null);
    expect(parseFontSizeInput("1e2")).toBe(null);
    expect(parseFontSizeInput("7")).toBe(null);
    expect(parseFontSizeInput("33")).toBe(null);
  });

  it("normalizes invalid persisted values", () => {
    expect(normalizeFontSize(18)).toBe(18);
    expect(normalizeFontSize(12.5)).toBe(ROOT_FONT_SIZE);
    expect(normalizeFontSize("16")).toBe(ROOT_FONT_SIZE);
  });

  it("steps within the supported range", () => {
    expect(stepFontSize(14, -1)).toBe(13);
    expect(stepFontSize(14, 1)).toBe(15);
    expect(stepFontSize(8, -1)).toBe(8);
    expect(stepFontSize(32, 1)).toBe(32);
  });
});
