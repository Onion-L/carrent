/// <reference types="vite/client" />

import type { RuntimeId, RuntimeRecord, RuntimeVerificationResult } from "../shared/runtimes";
import type { ChatTurnRequest, ChatRunEvent } from "../shared/chat";

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
      chat: {
        send: (request: ChatTurnRequest) => Promise<{ runId: string }>;
        stop: (runId: string) => Promise<void>;
        onEvent: (listener: (event: ChatRunEvent) => void) => VoidFunction;
      };
      dialog: {
        openDirectory: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      };
      shell: {
        openPath: (filePath: string) => Promise<string>;
      };
      clipboard: {
        writeText: (text: string) => Promise<void>;
      };
    };
  }
}

export {};
