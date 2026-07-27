import { runtimeIds, type RuntimeId } from "./runtimes";

export function buildProviderSessionKey(runtimeId: RuntimeId, threadId: string) {
  return `${runtimeId}:${threadId}`;
}

export function isInconsistentProviderSessionKey(
  storedKey: string,
  runtimeId: RuntimeId,
  threadId: string,
) {
  const expectedKey = buildProviderSessionKey(runtimeId, threadId);
  if (storedKey === expectedKey) return false;

  const separator = storedKey.indexOf(":");
  const storedRuntimeId = storedKey.slice(0, separator);
  if (!runtimeIds.includes(storedRuntimeId as RuntimeId)) return false;

  return storedRuntimeId === runtimeId && storedKey.endsWith(`:${threadId}`);
}
