import type { RuntimeDescriptor } from "../../src/shared/runtimes";

export const runtimeCatalog = [
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    versionArgs: ["--version"],
    configMarkers: ["~/.codex", "~/.config/codex"],
    supportsModelPing: true,
    detection: {
      localCheck: {
        mayUseTokens: false,
      },
    },
    verification: {
      modelPing: {
        prompt: "Reply with exactly OK.",
        mayUseTokens: true,
      },
    },
  },
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    configMarkers: ["~/.claude"],
    supportsModelPing: false,
    detection: {
      localCheck: {
        mayUseTokens: false,
      },
    },
    verification: {},
  },
] satisfies RuntimeDescriptor[];
