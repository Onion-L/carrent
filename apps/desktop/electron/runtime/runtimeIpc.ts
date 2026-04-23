import type {
  RuntimeId,
  RuntimeRecord,
  RuntimeVerificationResult,
} from "../../src/shared/runtimes";
import { runtimeCatalog } from "./runtimeCatalog";
import { detectRuntime } from "./runtimeDetector";
import { runLocalCheck, runModelPing } from "./runtimeVerifier";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (
      event: unknown,
      runtimeId?: RuntimeId,
    ) => Promise<RuntimeRecord[] | RuntimeVerificationResult>,
  ) => void;
}

interface RuntimeIpcServices {
  list: () => Promise<RuntimeRecord[]>;
  localCheck: (runtimeId: RuntimeId) => Promise<RuntimeVerificationResult>;
  modelPing: (runtimeId: RuntimeId) => Promise<RuntimeVerificationResult>;
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
}

export function createRuntimeIpcServices(): RuntimeIpcServices {
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
