import { closeSync, fstatSync, openSync, readSync } from "node:fs";

const MAX_HISTORY_FILE_BYTES = 4 * 1024 * 1024;

export function readHistoryTail(path: string) {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, MAX_HISTORY_FILE_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, Math.max(0, size - length));
    const content = buffer.toString("utf8");
    return size > length ? content.slice(Math.max(0, content.indexOf("\n") + 1)) : content;
  } catch {
    return "";
  } finally {
    if (descriptor != null) closeSync(descriptor);
  }
}
