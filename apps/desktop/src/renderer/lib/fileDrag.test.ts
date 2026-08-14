import { describe, expect, it } from "bun:test";

import { isFilesystemFileDrag } from "./fileDrag";

function dataTransfer(types: string[]): DataTransfer {
  return { types } as unknown as DataTransfer;
}

describe("isFilesystemFileDrag", () => {
  it("accepts pure file drags", () => {
    expect(isFilesystemFileDrag(dataTransfer(["Files"]))).toBe(true);
  });

  it("rejects drags carrying web content", () => {
    expect(isFilesystemFileDrag(dataTransfer(["Files", "text/uri-list"]))).toBe(false);
    expect(isFilesystemFileDrag(dataTransfer(["Files", "text/html"]))).toBe(false);
    expect(isFilesystemFileDrag(dataTransfer(["text/plain"]))).toBe(false);
  });

  it("rejects a missing DataTransfer", () => {
    expect(isFilesystemFileDrag(null)).toBe(false);
  });
});
