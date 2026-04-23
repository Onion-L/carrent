import { useEffect, useState } from "react";

import type { RuntimeId, RuntimeRecord, RuntimeVerificationResult } from "../../shared/runtimes";

type RuntimeActionState =
  | "idle"
  | "local-check"
  | "model-ping"
  | "starting"
  | "stopping"
  | "restarting";

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
      const freshRuntimes = await window.carrent.runtimes.list();

      setState((current) => {
        const merged = freshRuntimes.map((fresh) => {
          const existing = current.runtimes.find((r) => r.id === fresh.id);
          if (!existing) return fresh;
          return {
            ...fresh,
            verification: existing.verification,
            lastVerifiedAt: existing.lastVerifiedAt,
            lastError: existing.lastError,
          };
        });
        return {
          ...current,
          runtimes: merged,
          loading: false,
        };
      });
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

  async function start(id: RuntimeId) {
    await runLifecycleAction(id, "starting", window.carrent.runtimes.start);
  }

  async function stop(id: RuntimeId) {
    await runLifecycleAction(id, "stopping", window.carrent.runtimes.stop);
  }

  async function restart(id: RuntimeId) {
    await runLifecycleAction(id, "restarting", window.carrent.runtimes.restart);
  }

  async function startAll() {
    await runGlobalAction("starting", window.carrent.runtimes.startAll);
  }

  async function stopAll() {
    await runGlobalAction("stopping", window.carrent.runtimes.stopAll);
  }

  async function restartAll() {
    await runGlobalAction("restarting", window.carrent.runtimes.restartAll);
  }

  async function runGlobalAction(
    action: Extract<RuntimeActionState, "starting" | "stopping" | "restarting">,
    actionRunner: () => Promise<void>,
  ) {
    // Mark all runtimes as pending
    setState((current) => {
      const next: Record<string, RuntimeActionState> = {
        ...current.actionStateById,
      };
      for (const runtime of current.runtimes) {
        next[runtime.id] = action;
      }
      return {
        ...current,
        error: undefined,
        actionStateById: next,
      };
    });

    try {
      await actionRunner();
      await refresh();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(error, `${action} all failed.`),
      }));
    } finally {
      setState((current) => {
        const next: Record<string, RuntimeActionState> = {
          ...current.actionStateById,
        };
        for (const runtime of current.runtimes) {
          next[runtime.id] = "idle";
        }
        return {
          ...current,
          actionStateById: next,
        };
      });
    }
  }

  async function runLifecycleAction(
    id: RuntimeId,
    action: Extract<RuntimeActionState, "starting" | "stopping" | "restarting">,
    actionRunner: (runtimeId: RuntimeId) => Promise<void>,
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
      await actionRunner(id);
      await refresh();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: getErrorMessage(error, `${action} failed.`),
      }));
    } finally {
      setState((current) => ({
        ...current,
        actionStateById: {
          ...current.actionStateById,
          [id]: "idle",
        },
      }));
    }
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

      await refresh();
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
    start,
    stop,
    restart,
    startAll,
    stopAll,
    restartAll,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}
