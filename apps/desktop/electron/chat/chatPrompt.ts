import type { ChatTurnRequest, Attachment } from "../../src/shared/chat";
import type { LocalPathContextItem } from "../../src/shared/localPathContext";

const MAX_TRANSCRIPT_MESSAGES = 6;
const MAX_TRANSCRIPT_CHARS = 6000;
export const DEFAULT_IMAGE_ONLY_PROMPT = "Inspect the attached images and describe what you see.";
export const DEFAULT_FILE_ONLY_PROMPT =
  "Inspect the attached files and summarize the relevant contents.";
export const DEFAULT_FOLDER_ONLY_PROMPT =
  "Inspect the referenced folder and summarize the relevant contents.";

export function buildChatPrompt(
  request: ChatTurnRequest,
  options?: { includeTranscript?: boolean },
): string {
  const recentTranscript =
    options?.includeTranscript === false ? [] : trimTranscript(request.transcript);

  const contextLine = `Project: ${request.context.workingDirectory}`;

  const parts: string[] = [contextLine, ``];

  if (recentTranscript.length > 0) {
    parts.push("Recent conversation:");
    for (const turn of recentTranscript) {
      parts.push(`${turn.role}: ${turn.content}`);
    }
    parts.push("");
  }

  const messageText =
    request.message.trim() || getDefaultMessage(request.attachments, request.localPathContexts);
  parts.push(`user: ${messageText}`);

  const textOnlyAttachmentSection = buildTextOnlyAttachmentSection(request.attachments);
  if (textOnlyAttachmentSection) {
    parts.push("");
    parts.push(textOnlyAttachmentSection);
  }

  const localPathContextSection = buildLocalPathContextSection(request.localPathContexts);
  if (localPathContextSection) {
    parts.push("");
    parts.push(localPathContextSection);
  }

  return parts.join("\n");
}

function getDefaultMessage(
  attachments: ChatTurnRequest["attachments"],
  localPathContexts: ChatTurnRequest["localPathContexts"],
): string {
  if (localPathContexts?.some((item) => item.kind === "file")) {
    return DEFAULT_FILE_ONLY_PROMPT;
  }
  if (localPathContexts?.some((item) => item.kind === "directory")) {
    return DEFAULT_FOLDER_ONLY_PROMPT;
  }
  if (!attachments || attachments.length === 0) {
    return "";
  }

  return attachments.every((attachment) => attachment.kind === "image")
    ? DEFAULT_IMAGE_ONLY_PROMPT
    : DEFAULT_FILE_ONLY_PROMPT;
}

function buildTextOnlyAttachmentSection(
  attachments: ChatTurnRequest["attachments"],
): string | null {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const withPath = attachments.filter(
    (attachment): attachment is Attachment & { localPath: string } =>
      typeof attachment.localPath === "string",
  );

  if (withPath.length === 0) {
    return null;
  }

  const lines = ["Attached files:"];
  for (const attachment of withPath) {
    lines.push(`- ${attachment.name}: ${attachment.localPath}`);
  }

  return lines.join("\n");
}

// Presents dragged Local Path Context as plain-text prompt context. No Markdown
// is used so exact paths containing spaces, brackets, parentheses, and Unicode
// survive verbatim without fragile escaping. This text is informational; the
// Agent read allowlist (built at Run start) is the authorization boundary.
export function buildLocalPathContextSection(
  contexts: LocalPathContextItem[] | undefined,
): string | null {
  if (!contexts || contexts.length === 0) {
    return null;
  }

  const lines = ["Local path context (user-provided references):"];
  for (const item of contexts) {
    lines.push(`- ${item.kind} ${item.basename} — ${item.path}`);
  }

  return lines.join("\n");
}

function trimTranscript(transcript: ChatTurnRequest["transcript"]): ChatTurnRequest["transcript"] {
  // Keep only the most recent messages up to the limit
  const recent = transcript.slice(-MAX_TRANSCRIPT_MESSAGES);

  // Also apply a character cap by dropping older messages
  let serialized = recent.map((t) => `${t.role}: ${t.content}`).join("\n");
  while (serialized.length > MAX_TRANSCRIPT_CHARS && recent.length > 0) {
    recent.shift();
    serialized = recent.map((t) => `${t.role}: ${t.content}`).join("\n");
  }

  return recent;
}
