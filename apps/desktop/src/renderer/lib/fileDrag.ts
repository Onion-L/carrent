// A drag is a local filesystem drop only when it carries files without web
// content: drags with text/uri-list or text/html (remote URLs, page text,
// browser images without local backing files) must keep their existing
// behavior. Both ConversationDropSurface and the window-wide file-drop
// navigation guard rely on this exact classification.
export function isFilesystemFileDrag(dataTransfer: DataTransfer | null): boolean {
  const types = Array.from(dataTransfer?.types ?? []);
  return (
    types.includes("Files") && !types.includes("text/uri-list") && !types.includes("text/html")
  );
}
