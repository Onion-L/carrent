import type { ChatTurnRequest, ImageAttachment } from "../../src/shared/chat";

const MAX_TRANSCRIPT_MESSAGES = 6;
const MAX_TRANSCRIPT_CHARS = 6000;
export const DEFAULT_IMAGE_ONLY_PROMPT = "Inspect the attached images and describe what you see.";

export function buildChatPrompt(
  request: ChatTurnRequest,
  options?: { includeTranscript?: boolean },
): string {
  const recentTranscript =
    options?.includeTranscript === false ? [] : trimTranscript(request.transcript);

  const contextLine =
    request.workspace.kind === "project"
      ? `Project: ${request.workspace.projectPath}`
      : "Context: General chat. No project folder is selected.";

  const parts: string[] = [contextLine, ``];

  if (recentTranscript.length > 0) {
    parts.push("Recent conversation:");
    for (const turn of recentTranscript) {
      parts.push(`${turn.role}: ${turn.content}`);
    }
    parts.push("");
  }

  const messageText = request.message.trim() || getDefaultMessage(request.attachments);
  parts.push(`user: ${messageText}`);

  const textOnlyImageSection = buildTextOnlyImageSection(request.attachments);
  if (textOnlyImageSection) {
    parts.push("");
    parts.push(textOnlyImageSection);
  }

  return parts.join("\n");
}

function getDefaultMessage(attachments: ChatTurnRequest["attachments"]): string {
  if (attachments && attachments.length > 0) {
    return DEFAULT_IMAGE_ONLY_PROMPT;
  }

  return "";
}

function buildTextOnlyImageSection(attachments: ChatTurnRequest["attachments"]): string | null {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const withPath = attachments.filter(
    (attachment): attachment is ImageAttachment & { localPath: string } =>
      typeof attachment.localPath === "string",
  );

  if (withPath.length === 0) {
    return null;
  }

  const lines = ["Attached images:"];
  for (const attachment of withPath) {
    lines.push(`- ${attachment.name}: ${attachment.localPath}`);
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
