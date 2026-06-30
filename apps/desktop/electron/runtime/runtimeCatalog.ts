import type { RuntimeDescriptor } from "../../src/shared/runtimes";

export const runtimeCatalog: RuntimeDescriptor[] = [
  {
    id: "kimi",
    name: "Kimi Code",
    command: "kimi",
    versionArgs: ["--version"],
    configMarkers: ["~/.kimi-code", "~/.config/kimi-code"],
    supportsModelPing: false,
    detection: {
      localCheck: {
        mayUseTokens: false,
      },
    },
    verification: {},
  },
];
