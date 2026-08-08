// Fixed long-answer fixture for the streaming performance verification tests.
// Covers prose, headings, lists, links, emphasis, fenced code and math so the
// same representative answer can drive reveal, scroll and Markdown baselines.
// Kept deterministic: tests assert exact final text and comparable counts.

export const LONG_STREAMING_ANSWER = [
  "# Streaming Verification Answer",
  "",
  "This paragraph is ordinary prose that keeps arriving while the Run is active. ",
  "It exists to give the reveal scheduler a realistic amount of text to work ",
  "through, long enough that the typewriter has to adapt its pace instead of ",
  "showing everything in a handful of frames. A second sentence adds **bold** ",
  "and *italic* emphasis plus [a reference link](https://example.com/docs) so ",
  "inline Markdown constructs stream through the same pipeline.",
  "",
  "## What the agent checked",
  "",
  "- read the runtime detection module and its tests",
  "- reproduced the issue with a controlled animation frame harness",
  "- coalesced the streaming updates into one commit per frame",
  "- verified the final text matches the authoritative answer exactly",
  "",
  "1. first ordered step with a longer explanation that keeps the list item",
  "   flowing across more than one streamed chunk of output",
  "2. second ordered step",
  "3. third ordered step",
  "",
  "The relevant change looks like this:",
  "",
  "```ts",
  "export function coalesce<T>(pending: T[], flush: (items: T[]) => void): void {",
  "  if (pending.length === 0) {",
  "    return;",
  "  }",
  "  const batch = pending.splice(0, pending.length);",
  "  flush(batch);",
  "}",
  "",
  "export const MAX_CATCH_UP_FRAMES = 24;",
  "```",
  "",
  "After the code block the answer continues with more prose so that trailing ",
  "text also has to stream. The reveal must remain a strict prefix of the ",
  "authoritative text at every point, and the completed message must equal the ",
  "Runtime answer character for character, including whitespace and newlines.",
  "",
  "Math renders while streaming too: the identity $e^{i\\pi} + 1 = 0$ inline,",
  "and a display formula below.",
  "",
  String.raw`\[ \frac{\partial}{\partial t} \Psi = i \hbar \nabla^2 \Psi \]`,
  "",
  "Closing remarks round the answer out. They are deliberately uneventful prose ",
  "so the fixture ends the way real answers end: with a few calm sentences that ",
  "still have to survive batching, snapshot resynchronization and terminal ",
  "catch-up without losing, duplicating or reordering a single character.",
].join("\n");

// Deterministic irregular chunk sizes: simulates uneven Runtime chunking
// (tiny keep-alive deltas mixed with large buffered dumps) without Math.random.
const CHUNK_SIZE_PATTERN = [3, 64, 17, 240, 8, 128, 41, 5, 96, 512];

export function chunkStreamingAnswer(text: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  let patternIndex = 0;
  while (offset < text.length) {
    const size = CHUNK_SIZE_PATTERN[patternIndex % CHUNK_SIZE_PATTERN.length]!;
    patternIndex += 1;
    chunks.push(text.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

// Cumulative prefixes of the deterministic chunks: the visible-text commits a
// frame-batched streaming window produces for the fixture.
export function streamingRevealPrefixes(text: string): string[] {
  const chunks = chunkStreamingAnswer(text);
  return chunks.map((_, index) => chunks.slice(0, index + 1).join(""));
}
