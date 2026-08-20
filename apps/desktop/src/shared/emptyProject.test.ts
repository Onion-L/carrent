import { describe, expect, it } from "bun:test";

import { validateNewProjectName } from "./emptyProject";

describe("validateNewProjectName", () => {
  it("trims outer whitespace and keeps the inner name untouched", () => {
    expect(validateNewProjectName("  My Project  ")).toEqual({ ok: true, name: "My Project" });
  });

  it("accepts Unicode names and internal spaces", () => {
    expect(validateNewProjectName("我的 项目")).toEqual({ ok: true, name: "我的 项目" });
    expect(validateNewProjectName("émoji 🚀 launch")).toEqual({
      ok: true,
      name: "émoji 🚀 launch",
    });
  });

  it("rejects empty names", () => {
    expect(validateNewProjectName("").ok).toBe(false);
    expect(validateNewProjectName("   ").ok).toBe(false);
  });

  it("rejects path separators", () => {
    expect(validateNewProjectName("a/b").ok).toBe(false);
    expect(validateNewProjectName("a\\b").ok).toBe(false);
  });

  it("rejects control characters", () => {
    expect(validateNewProjectName("a\0b").ok).toBe(false);
    expect(validateNewProjectName("a\nb").ok).toBe(false);
    expect(validateNewProjectName("a\u007fb").ok).toBe(false);
  });

  it("rejects Windows-invalid characters", () => {
    for (const character of ["<", ">", ":", '"', "|", "?", "*"]) {
      expect(validateNewProjectName(`a${character}b`).ok).toBe(false);
    }
  });

  it("rejects dot-only names", () => {
    expect(validateNewProjectName(".").ok).toBe(false);
    expect(validateNewProjectName("..").ok).toBe(false);
  });

  it("trims trailing spaces and rejects trailing periods", () => {
    // Outer whitespace is trimmed before validation, so a trailing space never
    // reaches the filesystem; a trailing period does and must be rejected.
    expect(validateNewProjectName("name ")).toEqual({ ok: true, name: "name" });
    expect(validateNewProjectName("name.").ok).toBe(false);
    expect(validateNewProjectName("name .").ok).toBe(false);
  });

  it("rejects Windows device names, case-insensitively and with extensions", () => {
    for (const name of ["CON", "con", "prn", "AUX", "NUL", "COM1", "com9", "LPT3", "CON.txt"]) {
      expect(validateNewProjectName(name).ok).toBe(false);
    }
    expect(validateNewProjectName("console").ok).toBe(true);
    expect(validateNewProjectName("COM10").ok).toBe(true);
  });

  it("rejects names over 100 characters", () => {
    expect(validateNewProjectName("a".repeat(100)).ok).toBe(true);
    expect(validateNewProjectName("a".repeat(101)).ok).toBe(false);
  });

  it("does not rewrite valid names", () => {
    expect(validateNewProjectName("My (Draft) [v2]")).toEqual({
      ok: true,
      name: "My (Draft) [v2]",
    });
  });
});
