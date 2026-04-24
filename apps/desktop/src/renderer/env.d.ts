/// <reference types="vite/client" />

import type { RuntimeId, RuntimeRecord, RuntimeVerificationResult } from "../shared/runtimes";

declare global {
  interface Window {
    carrent: {
      platform: NodeJS.Platform;
      electronVersion: string;
      runtimes: {
        list: () => Promise<RuntimeRecord[]>;
        localCheck: (id: RuntimeId) => Promise<RuntimeVerificationResult>;
        modelPing: (id: RuntimeId) => Promise<RuntimeVerificationResult>;
        start: (id: RuntimeId) => Promise<void>;
        stop: (id: RuntimeId) => Promise<void>;
        restart: (id: RuntimeId) => Promise<void>;
        refreshVersion: (id: RuntimeId) => Promise<RuntimeRecord>;
        startAll: () => Promise<void>;
        stopAll: () => Promise<void>;
        restartAll: () => Promise<void>;
      };
    };
  }
}

export {};
