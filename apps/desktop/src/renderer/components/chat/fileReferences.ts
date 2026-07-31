export type FileReferenceSegment =
  | { type: "text"; content: string }
  | { type: "file"; label: string; path: string };

const FILE_REFERENCE_PATTERN = /\[((?!\$)[^\]\n]+)\]\((\/[^)\n]+)\)/gu;

export function parseFileReferenceSegments(content: string): FileReferenceSegment[] {
  const segments: FileReferenceSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(FILE_REFERENCE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", content: content.slice(lastIndex, index) });
    }

    segments.push({ type: "file", label: match[1], path: match[2] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", content: content.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", content }];
}

export function hasFileReference(content: string) {
  return parseFileReferenceSegments(content).some((segment) => segment.type === "file");
}
