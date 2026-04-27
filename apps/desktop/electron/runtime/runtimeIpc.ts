import type {
  RuntimeId,
  RuntimeRecord,
  RuntimeVerificationResult,
} from "../../src/shared/runtimes";
import { runtimeCatalog } from "./runtimeCatalog";
import { detectRuntime } from "./runtimeDetector";
import { runLocalCheck, runModelPing } from "./runtimeVerifier";
import { runtimeProcessManager, type RuntimeProcessManager } from "./runtimeProcessManager";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (
      event: unknown,
      runtimeId?: RuntimeId,
    ) => Promise<RuntimeRecord[] | RuntimeRecord | RuntimeVerificationResult | void> | void,
  ) => void;
}

interface RuntimeIpcServices {
  list: () => Promise<RuntimeRecord[]>;
  localCheck: (runtimeId: RuntimeId) => Promise<RuntimeVerificationResult>;
  modelPing: (runtimeId: RuntimeId) => Promise<RuntimeVerificationResult>;
  start: (runtimeId: RuntimeId) => Promise<void>;
  stop: (runtimeId: RuntimeId) => Promise<void>;
  restart: (runtimeId: RuntimeId) => Promise<void>;
  refreshVersion: (runtimeId: RuntimeId) => Promise<RuntimeRecord>;
  startAll: () => Promise<void>;
  stopAll: () => Promise<void>;
  restartAll: () => Promise<void>;
}

export function registerRuntimeIpc(
  ipcMainLike: IpcMainLike,
  services: RuntimeIpcServices = createRuntimeIpcServices(),
) {
  ipcMainLike.handle("runtimes:list", async () => services.list());
  ipcMainLike.handle("runtimes:local-check", async (_event, runtimeId) =>
    services.localCheck(assertRuntimeId(runtimeId)),
  );
  ipcMainLike.handle("runtimes:model-ping", async (_event, runtimeId) =>
    services.modelPing(assertRuntimeId(runtimeId)),
  );
  ipcMainLike.handle("runtimes:start", (_event, runtimeId) =>
    services.start(assertRuntimeId(runtimeId)),
  );
  ipcMainLike.handle("runtimes:stop", (_event, runtimeId) =>
    services.stop(assertRuntimeId(runtimeId)),
  );
  ipcMainLike.handle("runtimes:restart", (_event, runtimeId) =>
    services.restart(assertRuntimeId(runtimeId)),
  );
  ipcMainLike.handle("runtimes:refresh-version", (_event, runtimeId) =>
    services.refreshVersion(assertRuntimeId(runtimeId)),
  );
  ipcMainLike.handle("runtimes:start-all", () => services.startAll());
  ipcMainLike.handle("runtimes:stop-all", () => services.stopAll());
  ipcMainLike.handle("runtimes:restart-all", () => services.restartAll());
}

export function createRuntimeIpcServices(
  processManager: RuntimeProcessManager = runtimeProcessManager,
): RuntimeIpcServices {
  return {
    async list() {
      return Promise.all(runtimeCatalog.map((runtime) => detectRuntime(runtime)));
    },
    async localCheck(runtimeId) {
      return runLocalCheck(getRuntimeDescriptor(runtimeId));
    },
    async modelPing(runtimeId) {
      return runModelPing(getRuntimeDescriptor(runtimeId));
    },
    async start(runtimeId) {
      processManager.start(runtimeId);
    },
    async stop(runtimeId) {
      processManager.stop(runtimeId);
    },
    async restart(runtimeId) {
      processManager.restart(runtimeId);
    },
    async refreshVersion(runtimeId) {
      return detectRuntime(getRuntimeDescriptor(runtimeId));
    },
    async startAll() {
      processManager.startAll();
    },
    async stopAll() {
      processManager.stopAll();
    },
    async restartAll() {
      processManager.restartAll();
    },
  };
}

function getRuntimeDescriptor(runtimeId: RuntimeId) {
  const runtime = runtimeCatalog.find((entry) => entry.id === runtimeId);

  if (runtime == null) {
    throw new Error(`Unknown runtime: ${runtimeId}`);
  }

  return runtime;
}

function assertRuntimeId(runtimeId: RuntimeId | undefined): RuntimeId {
  if (runtimeId == null) {
    throw new Error("Runtime id is required.");
  }

  return runtimeId;
}
