/// <reference types="vite/client" />

import type {
  RuntimeId,
  RuntimeRecord,
  RuntimeVerificationResult,
} from "../shared/runtimes";

declare global {
  interface Window {
    carrent: {
      platform: NodeJS.Platform;
      electronVersion: string;
      runtimes: {
        list: () => Promise<RuntimeRecord[]>;
        localCheck: (id: RuntimeId) => Promise<RuntimeVerificationResult>;
        modelPing: (id: RuntimeId) => Promise<RuntimeVerificationResult>;
      };
    };
  }
}

export {};
