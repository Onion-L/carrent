import { Monitor, CheckCircle2, XCircle, HelpCircle } from "lucide-react";

import type {
  RuntimeAvailability,
  RuntimeConfigState,
  RuntimeRecord,
  RuntimeVerificationState,
} from "../../shared/runtimes";
import { useRuntimes } from "../hooks/useRuntimes";

const availabilityTone = {
  detected: "success",
  unavailable: "danger",
} satisfies Record<RuntimeAvailability, BadgeTone>;

const configurationTone = {
  configured: "success",
  missing: "warning",
  unknown: "neutral",
} satisfies Record<RuntimeConfigState, BadgeTone>;

const verificationTone = {
  never: "neutral",
  passed: "success",
  failed: "danger",
  unsupported: "warning",
} satisfies Record<RuntimeVerificationState, BadgeTone>;

type BadgeTone = "success" | "danger" | "warning" | "neutral";

export function RuntimesPage() {
  const { runtimes, loading, error, actionStateById, refresh, runLocalCheck, runModelPing } =
    useRuntimes();

  async function handleModelPing(runtime: RuntimeRecord) {
    const confirmed = window.confirm(
      "This runtime check may use a small amount of tokens. Continue?",
    );

    if (!confirmed) {
      return;
    }

    await runModelPing(runtime.id);
  }

  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-[#181818]">
      <div className="mx-auto w-full max-w-3xl p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[18px] font-semibold text-[#eee]">Runtimes</h1>
            <p className="mt-1 text-[13px] text-[#666]">
              Detect local CLI runtimes and run manual verification when needed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-lg border border-[#333] bg-[#232323] px-3 py-2 text-[12px] font-medium text-[#ddd] transition hover:border-[#444] hover:bg-[#272727] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Detecting..." : "Detect Again"}
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-300">
            {error}
          </div>
        ) : null}

        {loading && runtimes.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] py-16 text-[#666]">
            <Monitor className="h-10 w-10" />
            <p className="text-[15px]">Detecting local runtimes...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {runtimes.map((runtime) => (
              <div
                key={runtime.id}
                className="flex flex-col gap-4 rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] p-4 lg:flex-row lg:items-start lg:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#252525]">
                    <Monitor className="h-4 w-4 text-[#888]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium text-[#ddd]">{runtime.name}</span>
                      <RuntimeStatusBadge
                        label="Availability"
                        status={runtime.availability}
                        tone={availabilityTone[runtime.availability]}
                      />
                      <RuntimeStatusBadge
                        label="Config"
                        status={runtime.configuration}
                        tone={configurationTone[runtime.configuration]}
                      />
                      <RuntimeStatusBadge
                        label="Verification"
                        status={runtime.verification}
                        tone={verificationTone[runtime.verification]}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#666]">
                      <span>
                        <span className="text-[#555]">Path:</span> {runtime.path ?? "Not found"}
                      </span>
                      <span>
                        <span className="text-[#555]">Version:</span>{" "}
                        {runtime.version ?? "Unknown"}
                      </span>
                      <span>
                        <span className="text-[#555]">Last checked:</span>{" "}
                        {formatTimestamp(runtime.lastCheckedAt)}
                      </span>
                      <span>
                        <span className="text-[#555]">Last verified:</span>{" "}
                        {formatTimestamp(runtime.lastVerifiedAt)}
                      </span>
                    </div>
                    {runtime.lastError ? (
                      <p className="mt-2 max-w-2xl text-[12px] text-red-300">
                        {runtime.lastError}
                      </p>
                    ) : (
                      <p className="mt-2 text-[12px] text-[#555]">
                        {runtime.availability === "detected"
                          ? "Ready to bind after manual verification."
                          : "Install and configure the CLI locally before binding it."}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void runLocalCheck(runtime.id)}
                    disabled={isActionRunning(actionStateById, runtime.id)}
                    className="rounded-lg border border-[#333] bg-[#232323] px-3 py-2 text-[12px] font-medium text-[#ddd] transition hover:border-[#444] hover:bg-[#272727] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionStateById[runtime.id] === "local-check"
                      ? "Checking..."
                      : "Local Check (0 token)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleModelPing(runtime)}
                    disabled={!runtime.supportsModelPing || isActionRunning(actionStateById, runtime.id)}
                    className="rounded-lg border border-[#333] bg-[#232323] px-3 py-2 text-[12px] font-medium text-[#ddd] transition hover:border-[#444] hover:bg-[#272727] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionStateById[runtime.id] === "model-ping"
                      ? "Pinging..."
                      : "Model Ping (may use tokens)"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimeStatusBadge({
  label,
  status,
  tone,
}: {
  label: string;
  status: string;
  tone: BadgeTone;
}) {
  const config = {
    success: {
      icon: CheckCircle2,
      className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
    },
    danger: {
      icon: XCircle,
      className: "border-red-500/20 bg-red-500/10 text-red-400",
    },
    warning: {
      icon: HelpCircle,
      className: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    },
    neutral: {
      icon: HelpCircle,
      className: "border-[#444] bg-[#252525] text-[#888]",
    },
  };

  const { icon: Icon, className } = config[tone];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize ${className}`}
    >
      <Icon className="h-3 w-3" />
      {label}: {status}
    </span>
  );
}

function isActionRunning(
  actionStateById: Record<string, "idle" | "local-check" | "model-ping">,
  runtimeId: string,
) {
  return (
    actionStateById[runtimeId] != null && actionStateById[runtimeId] !== "idle"
  );
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}
