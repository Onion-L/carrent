import { createTwoFilesPatch } from "diff";

export function createEditDiff(filePath: string, before: string, after: string): string {
  return createTwoFilesPatch(filePath, filePath, before, after, "before", "after");
}
