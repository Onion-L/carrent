import type { RuntimeId, RuntimeRecord } from "../../shared/runtimes";

export function resolveRuntimeEnabled(
  runtime: Pick<RuntimeRecord, "id" | "availability">,
  runtimeEnabledById: Partial<Record<RuntimeId, boolean>>,
) {
  return runtimeEnabledById[runtime.id] ?? runtime.availability === "detected";
}

export function getDetectedRuntimes(runtimes: RuntimeRecord[]) {
  return runtimes.filter((runtime) => runtime.availability === "detected");
}

export function getChatRuntimeOptions(runtimes: RuntimeRecord[]) {
  return runtimes.filter((runtime) => runtime.availability === "detected" && runtime.enabled);
}

export function isChatRuntimeAvailable(runtimeId: RuntimeId, runtimes: RuntimeRecord[]) {
  return getChatRuntimeOptions(runtimes).some((runtime) => runtime.id === runtimeId);
}
