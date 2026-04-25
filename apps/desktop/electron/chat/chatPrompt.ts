import type { ChatTurnRequest } from "../../src/shared/chat";

const MAX_TRANSCRIPT_MESSAGES = 6;
const MAX_TRANSCRIPT_CHARS = 6000;

export function buildChatPrompt(
  request: ChatTurnRequest,
  options?: { includeTranscript?: boolean },
): string {
  const recentTranscript =
    options?.includeTranscript === false ? [] : trimTranscript(request.transcript);

  const parts: string[] = [
    `Project: ${request.projectPath}`,
    ``,
    `You are ${request.agent.name}.`,
    `${request.agent.responsibility}`,
    ``,
  ];

  if (recentTranscript.length > 0) {
    parts.push("Recent conversation:");
    for (const turn of recentTranscript) {
      parts.push(`${turn.role}: ${turn.content}`);
    }
    parts.push("");
  }

  parts.push(`user: ${request.message}`);

  return parts.join("\n");
}

function trimTranscript(
  transcript: ChatTurnRequest["transcript"],
): ChatTurnRequest["transcript"] {
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
