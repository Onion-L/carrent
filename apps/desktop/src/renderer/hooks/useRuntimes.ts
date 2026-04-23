import { useEffect, useState } from "react";

import type {
  RuntimeId,
  RuntimeRecord,
  RuntimeVerificationResult,
} from "../../shared/runtimes";

type RuntimeActionState = "idle" | "local-check" | "model-ping";

type UseRuntimesState = {
  runtimes: RuntimeRecord[];
  loading: boolean;
  error?: string;
  actionStateById: Record<string, RuntimeActionState>;
};

export function useRuntimes() {
  const [state, setState] = useState<UseRuntimesState>({
    runtimes: [],
    loading: true,
    actionStateById: {},
  });

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setState((current) => ({
      ...current,
      loading: true,
      error: undefined,
    }));

    try {
      const runtimes = await window.carrent.runtimes.list();

      setState((current) => ({
        ...current,
        runtimes,
        loading: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: getErrorMessage(error, "Failed to detect runtimes."),
      }));
    }
  }

  async function runLocalCheck(id: RuntimeId) {
    await runVerification(id, "local-check", window.carrent.runtimes.localCheck);
  }

  async function runModelPing(id: RuntimeId) {
    await runVerification(id, "model-ping", window.carrent.runtimes.modelPing);
  }

  async function runVerification(
    id: RuntimeId,
    action: Exclude<RuntimeActionState, "idle">,
    actionRunner: (runtimeId: RuntimeId) => Promise<RuntimeVerificationResult>,
  ) {
    setState((current) => ({
      ...current,
      error: undefined,
      actionStateById: {
        ...current.actionStateById,
        [id]: action,
      },
    }));

    try {
      const result = await actionRunner(id);

      setState((current) => ({
        ...current,
        runtimes: current.runtimes.map((runtime) =>
          runtime.id === id
            ? {
                ...runtime,
                verification: result.verification,
                lastVerifiedAt: result.lastVerifiedAt ?? runtime.lastVerifiedAt,
                lastError: result.lastError,
              }
            : runtime,
        ),
        actionStateById: {
          ...current.actionStateById,
          [id]: "idle",
        },
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(error, "Runtime verification failed."),
        actionStateById: {
          ...current.actionStateById,
          [id]: "idle",
        },
      }));
    }
  }

  return {
    ...state,
    refresh,
    runLocalCheck,
    runModelPing,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}
