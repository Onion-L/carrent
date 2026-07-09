import { useEffect, useState, useRef } from "react";
import {
  Settings,
  RefreshCw,
  Download,
  ChevronDown,
  FileText,
  FolderOpen,
  Save,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useWorkspace } from "../context/WorkspaceContext";
import { useSettings } from "../context/SettingsContext";
import { upsertRtkAgentsBlock, type RtkGainStats } from "../../shared/rtk";
import type { RuntimeRecord } from "../../shared/runtimes";
import { resolveSettingsTabId, SETTINGS_TABS } from "../lib/settingsTabs";
import { RuntimeIcon } from "../components/RuntimeIcon";
import { useRuntimes } from "../hooks/useRuntimes";

/* -------------------------------------------------------------------------- */
/*  Toggle                                                                    */
/* -------------------------------------------------------------------------- */

function Toggle({
  enabled,
  onChange,
  label,
  description,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{label}</div>
        {description && <div className="mt-0.5 text-[12px] text-subtle">{description}</div>}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${
          enabled ? "bg-fg" : "bg-surface-hover"
        }`}
        aria-label={label}
      >
        <span
          className={`absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-bg transition-transform ${
            enabled ? "translate-x-[12px]" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Select (custom dropdown)                                                  */
/* -------------------------------------------------------------------------- */

function Select({
  value,
  onChange,
  options,
  label,
  description,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  description?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{label}</div>
        {description && <div className="mt-0.5 text-[12px] text-subtle">{description}</div>}
      </div>
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-[140px] items-center justify-between rounded-md border border-border bg-surface px-3 py-1.5 text-left transition-colors hover:border-border-strong"
        >
          <span className="text-[13px] text-fg">{selected?.label ?? value}</span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-subtle transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-10 mt-1 w-[140px] overflow-hidden rounded-md border border-border bg-surface shadow-lg shadow-black/10">
            {options.map((opt) => {
              const isActive = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full px-3 py-2 text-left text-[13px] transition-colors ${
                    isActive
                      ? "bg-surface-hover text-fg"
                      : "text-muted hover:bg-surface-raised hover:text-fg"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Static row                                                                */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  value,
  description,
}: {
  label: string;
  value: React.ReactNode;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13px] text-fg">{label}</div>
        {description && <div className="mt-0.5 text-[12px] text-subtle">{description}</div>}
      </div>
      <div className="shrink-0 text-[13px] text-muted">{value}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Check for updates                                                         */
/* -------------------------------------------------------------------------- */

function CheckForUpdatesRow() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{
    hasUpdate: boolean;
    latestVersion?: string;
  } | null>(null);

  async function handleCheck() {
    setChecking(true);
    setResult(null);
    try {
      const res = await window.carrent.settings.checkForUpdates();
      setResult(res);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13px] text-fg">Check for updates</div>
        {result && (
          <div className="mt-0.5 text-[12px] text-subtle">
            {result.hasUpdate ? `Update available: ${result.latestVersion}` : "Up to date"}
          </div>
        )}
      </div>
      <button
        onClick={handleCheck}
        disabled={checking}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
      >
        {checking ? (
          <RefreshCw className="h-3 w-3 animate-spin" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        {checking ? "Checking..." : "Check"}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Runtime status                                                            */
/* -------------------------------------------------------------------------- */

function RuntimeStatusPanel() {
  const { runtimes, loading, error, refresh } = useRuntimes();
  const sortedRuntimes = [...runtimes].sort((a, b) => a.name.localeCompare(b.name));
  const kimiRuntime = sortedRuntimes.find((runtime) => runtime.id === "kimi");
  const kimiSetupRequired = kimiRuntime ? shouldShowKimiSetup(kimiRuntime) : false;
  const enabledCount = sortedRuntimes.filter((runtime) => runtime.enabled).length;

  return (
    <div className="py-3.5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 text-[12px] text-muted">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${enabledCount > 0 ? "bg-success" : "bg-muted"}`}
          />
          {kimiSetupRequired ? (
            <span>Kimi Code setup required</span>
          ) : (
            <span>{enabledCount > 0 ? `${enabledCount} ready` : "No ready runtimes"}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error ? <div className="mb-3 text-[12px] text-danger">{error}</div> : null}

      {loading && sortedRuntimes.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-border px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-surface-raised" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3.5 w-28 rounded bg-surface-raised" />
                  <div className="h-2.5 w-44 rounded bg-surface-raised" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : sortedRuntimes.length > 0 ? (
        <div className="space-y-2">
          {sortedRuntimes.map((runtime) => {
            const showKimiSetup = shouldShowKimiSetup(runtime);

            return (
              <div
                key={runtime.id}
                className={`rounded-lg border ${
                  showKimiSetup
                    ? "border-border px-4 py-4"
                    : "border-border bg-surface/35 px-3.5 py-3 transition-colors hover:border-border-strong"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <RuntimeIcon name={runtime.name} size={showKimiSetup ? "md" : "sm"} />
                    {!showKimiSetup ? (
                      <span
                        className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg ${getRuntimeStatusDotClass(runtime)}`}
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-[14px] font-semibold text-fg">{runtime.name}</h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${getRuntimeStatusBadgeClass(runtime)}`}
                      >
                        {getRuntimeStatusLabel(runtime)}
                      </span>
                    </div>

                    {showKimiSetup ? (
                      <KimiSetupPanel
                        runtime={runtime}
                        loading={loading}
                        onRefresh={() => refresh()}
                      />
                    ) : (
                      <div className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-0.5 text-[11px] leading-4 text-subtle">
                        <span className="uppercase tracking-[0.08em]">Version</span>
                        <span className="truncate font-mono text-[11px] text-muted">
                          {runtime.version ?? "Unknown"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[12px] text-subtle">
          No supported CLI detected
        </div>
      )}
    </div>
  );
}

export function shouldShowKimiSetup(
  runtime: Pick<RuntimeRecord, "id" | "availability" | "configuration">,
) {
  return (
    runtime.id === "kimi" &&
    (runtime.availability !== "detected" || runtime.configuration !== "configured")
  );
}

function getRuntimeStatusLabel(runtime: RuntimeRecord) {
  if (shouldShowKimiSetup(runtime)) return "Setup required";
  if (runtime.enabled) return "Ready";
  if (runtime.availability === "detected") return "Disabled";
  return "Unavailable";
}

function getRuntimeStatusBadgeClass(runtime: RuntimeRecord) {
  const label = getRuntimeStatusLabel(runtime);
  if (label === "Ready") return "border-success/20 bg-success/10 text-success";
  if (label === "Setup required") return "border-warning/20 bg-warning/10 text-warning";
  if (label === "Unavailable") return "border-danger/20 bg-danger/10 text-danger";
  return "border-border bg-surface text-subtle";
}

function getRuntimeStatusDotClass(runtime: RuntimeRecord) {
  const label = getRuntimeStatusLabel(runtime);
  if (label === "Ready") return "bg-success shadow-[0_0_0_3px_rgb(var(--color-success)/0.12)]";
  if (label === "Unavailable") return "bg-danger shadow-[0_0_0_3px_rgb(var(--color-danger)/0.12)]";
  return "bg-muted";
}

function KimiSetupPanel({
  runtime,
  loading,
  onRefresh,
}: {
  runtime: RuntimeRecord;
  loading: boolean;
  onRefresh: () => Promise<void> | void;
}) {
  const setupSteps = getKimiSetupSteps(runtime);
  const setupAction = getKimiSetupAction(runtime, window.carrent.platform);
  const [copyFeedbackVisible, setCopyFeedbackVisible] = useState(false);
  const [hasCopiedSetupCommand, setHasCopiedSetupCommand] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [refreshAttemptedAfterCopy, setRefreshAttemptedAfterCopy] = useState(false);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCopyFeedbackVisible(false);
    setHasCopiedSetupCommand(false);
    setCopyError(null);
    setRefreshAttemptedAfterCopy(false);
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
  }, [setupAction.command]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  async function copySetupCommand() {
    setCopyError(null);
    try {
      await window.carrent.clipboard.writeText(setupAction.command);
      setCopyFeedbackVisible(true);
      setHasCopiedSetupCommand(true);
      setRefreshAttemptedAfterCopy(false);
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = setTimeout(() => {
        setCopyFeedbackVisible(false);
        copyFeedbackTimerRef.current = null;
      }, COPY_FEEDBACK_RESET_MS);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Failed to copy command.");
    }
  }

  async function refreshAfterSetup() {
    await onRefresh();
    if (hasCopiedSetupCommand) {
      setRefreshAttemptedAfterCopy(true);
    }
  }

  return (
    <div className="mt-5">
      <div className="text-[15px] font-medium text-fg">Kimi Code needs setup</div>
      <p className="mt-1 max-w-[54ch] text-[12px] leading-5 text-subtle">
        {setupAction.description}
      </p>

      <div className="mt-4 flex min-w-0 items-center gap-2 rounded-md bg-surface px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted">
          {setupAction.command}
        </code>
        <button
          type="button"
          onClick={copySetupCommand}
          className="flex h-7 min-w-[4.5rem] shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] text-muted transition-all duration-200 ease-out hover:bg-surface-hover hover:text-fg active:scale-[0.98]"
        >
          {copyFeedbackVisible ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          <span className="transition-opacity duration-200">
            {copyFeedbackVisible ? "Copied" : "Copy"}
          </span>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void refreshAfterSetup()}
          disabled={loading}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-[12px] text-bg transition-colors hover:opacity-90 disabled:opacity-30"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => window.open(KIMI_SETUP_DOCS_URL, "_blank", "noopener,noreferrer")}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <ExternalLink className="h-3 w-3" />
          Docs
        </button>
      </div>

      {copyError ? <div className="mt-2 text-[12px] text-danger">{copyError}</div> : null}
      {copyFeedbackVisible ? (
        <div className="mt-2 text-[12px] text-subtle">{setupAction.copiedMessage}</div>
      ) : null}
      {hasCopiedSetupCommand && refreshAttemptedAfterCopy && shouldShowKimiSetup(runtime) ? (
        <div className="mt-2 text-[12px] leading-5 text-subtle">{setupAction.refreshHelp}</div>
      ) : null}

      <div className="mt-5 space-y-2">
        {setupSteps.map((step) => {
          const StepIcon = step.done ? CheckCircle2 : Circle;
          return (
            <div key={step.label} className="flex items-center gap-2.5">
              <StepIcon
                className={`h-3.5 w-3.5 shrink-0 ${step.done ? "text-success" : "text-subtle"}`}
              />
              <div className={step.done ? "text-[12px] text-muted" : "text-[12px] text-fg"}>
                {step.label}
              </div>
            </div>
          );
        })}
      </div>

      {runtime.lastError ? (
        <details className="mt-5 border-t border-border pt-3">
          <summary className="cursor-pointer text-[12px] text-muted transition-colors hover:text-fg">
            Details
          </summary>
          <div className="mt-2 whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-danger/80">
            {runtime.lastError}
          </div>
        </details>
      ) : null}
    </div>
  );
}

const KIMI_SETUP_DOCS_URL = "https://moonshotai.github.io/kimi-code/en/guides/getting-started";
const COPY_FEEDBACK_RESET_MS = 2800;

export function getKimiSetupSteps(runtime: Pick<RuntimeRecord, "availability" | "configuration">) {
  const cliDetected = runtime.availability === "detected";
  const configured = runtime.configuration === "configured";

  return [
    {
      label: "Install Kimi Code CLI",
      done: cliDetected,
    },
    {
      label: 'Add "kimi" to PATH',
      done: cliDetected,
    },
    {
      label: "Finish Kimi sign-in",
      done: configured,
    },
  ];
}

type KimiSetupAction = {
  command: string;
  description: string;
  copiedMessage: string;
  refreshHelp: string;
};

export function getKimiSetupAction(
  runtime: Pick<RuntimeRecord, "availability" | "configuration">,
  platform: NodeJS.Platform,
): KimiSetupAction {
  if (runtime.availability === "detected" && runtime.configuration !== "configured") {
    return {
      command: "kimi",
      description: "Run Kimi once in a terminal and finish sign-in, then refresh detection.",
      copiedMessage: "Run this in a terminal, finish sign-in, then click Refresh.",
      refreshHelp:
        "If sign-in is complete but Carrent still shows setup required, check the Kimi config location or restart Carrent.",
    };
  }

  return {
    command: getKimiInstallCommand(platform),
    description:
      "Install the Kimi Code CLI first. After Carrent detects it, run kimi once to sign in.",
    copiedMessage:
      "Run this in a terminal, then click Refresh. Carrent will show the sign-in command next if needed.",
    refreshHelp:
      "If kimi works in Terminal but Carrent still cannot find it, restart Carrent or fix PATH.",
  };
}

export function getKimiInstallCommand(platform: NodeJS.Platform) {
  if (platform === "win32") {
    return "irm https://code.kimi.com/kimi-code/install.ps1 | iex";
  }

  return "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash";
}

/* -------------------------------------------------------------------------- */
/*  RTK stats                                                                 */
/* -------------------------------------------------------------------------- */

const RTK_PRELOAD_RESTART_MESSAGE =
  "RTK support is not loaded in the current window. Restart Carrent and try again.";

type RtkSettingsApi = {
  rtkGain?: () => Promise<RtkGainStats>;
};

export async function readRtkGainStats(settingsApi: RtkSettingsApi): Promise<RtkGainStats> {
  if (typeof settingsApi.rtkGain !== "function") {
    return createUnavailableRtkStats(RTK_PRELOAD_RESTART_MESSAGE);
  }

  try {
    return await settingsApi.rtkGain();
  } catch (error) {
    return createUnavailableRtkStats(
      error instanceof Error ? error.message : "Failed to refresh RTK stats.",
    );
  }
}

function createUnavailableRtkStats(error: string): RtkGainStats {
  return {
    available: false,
    totalCommands: 0,
    inputTokens: 0,
    outputTokens: 0,
    tokensSaved: 0,
    efficiency: 0,
    lastCheckedAt: new Date().toISOString(),
    error,
  };
}

function RtkStatsPanel() {
  const [stats, setStats] = useState<RtkGainStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentsSaving, setAgentsSaving] = useState(false);
  const [agentsMessage, setAgentsMessage] = useState<string | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setStats(await readRtkGainStats(window.carrent.settings));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function saveToAgents() {
    setAgentsSaving(true);
    setAgentsMessage(null);
    setAgentsError(null);
    try {
      const current = await readGlobalAgentInstructions(window.carrent.settings);
      const next = await writeGlobalAgentInstructions(
        window.carrent.settings,
        upsertRtkAgentsBlock(current.content),
      );
      setAgentsMessage(`Saved to ${next.path}`);
    } catch (error) {
      setAgentsError(
        error instanceof Error ? error.message : "Failed to save RTK instructions to AGENTS.md.",
      );
    } finally {
      setAgentsSaving(false);
    }
  }

  const efficiency = stats?.available ? Math.min(Math.max(stats.efficiency, 0), 100) : 0;

  return (
    <div className="mb-3 rounded-lg border border-border bg-surface px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-fg">Token optimization</div>
          <div className="mt-1 text-[12px] text-subtle">
            Route shell commands through RTK when it is available.
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40"
          title="Refresh RTK stats"
          aria-label="Refresh RTK stats"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="mt-4 text-[12px] text-muted">
        {loading
          ? stats
            ? "Refreshing RTK savings..."
            : "Loading RTK savings..."
          : stats?.available
            ? `${stats.totalCommands.toLocaleString()} commands saved ${formatTokens(stats.tokensSaved)} tokens · average efficiency ${stats.efficiency.toFixed(1)}%`
            : `RTK unavailable${stats?.error ? `: ${stats.error}` : ""}`}
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full rounded-full bg-muted transition-all"
          style={{ width: `${efficiency}%` }}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-3">
        <div
          className={`min-w-0 text-[12px] ${
            agentsError ? "text-danger" : agentsMessage ? "text-success" : "text-subtle"
          }`}
        >
          {agentsError ?? agentsMessage ?? "Persist RTK as a global agent instruction."}
        </div>
        <button
          type="button"
          onClick={saveToAgents}
          disabled={agentsSaving}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
        >
          {agentsSaving ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <FileText className="h-3 w-3" />
          )}
          {agentsSaving ? "Saving..." : "Add to AGENTS.md"}
        </button>
      </div>
    </div>
  );
}

function formatTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
}

/* -------------------------------------------------------------------------- */
/*  Global agent instructions                                                 */
/* -------------------------------------------------------------------------- */

type GlobalAgentInstructionsSnapshot = {
  path: string;
  content: string;
  exists: boolean;
  maxBytes: number;
};

type GlobalAgentInstructionsApi = {
  readGlobalAgentInstructions?: () => Promise<GlobalAgentInstructionsSnapshot>;
  writeGlobalAgentInstructions?: (content: string) => Promise<GlobalAgentInstructionsSnapshot>;
};

export function getGlobalAgentInstructionsByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}

export function formatGlobalAgentInstructionsSize(bytes: number): string {
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  return `${bytes}B`;
}

function GlobalAgentInstructionsPanel() {
  const [snapshot, setSnapshot] = useState<GlobalAgentInstructionsSnapshot | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const next = await readGlobalAgentInstructions(window.carrent.settings);
      setSnapshot(next);
      setContent(next.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load global agent instructions.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await writeGlobalAgentInstructions(window.carrent.settings, content);
      setSnapshot(next);
      setContent(next.content);
      setMessage("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save global agent instructions.");
    } finally {
      setSaving(false);
    }
  }

  async function openFile() {
    if (!snapshot?.exists) return;
    const result = await window.carrent.shell.openPath(snapshot.path);
    if (result) {
      setError(result);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const byteLength = getGlobalAgentInstructionsByteLength(content);
  const maxBytes = snapshot?.maxBytes ?? 256 * 1024;
  const tooLarge = byteLength > maxBytes;

  return (
    <div className="py-3.5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-fg">
            <FileText className="h-3.5 w-3.5 text-subtle" />
            Global agent instructions
          </div>
          <div className="mt-1 break-all text-[12px] text-subtle">
            {snapshot?.path ?? "~/.agents/AGENTS.md"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={openFile}
            disabled={!snapshot?.exists}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
          >
            <FolderOpen className="h-3 w-3" />
            Open
          </button>
          <button
            type="button"
            onClick={save}
            disabled={loading || saving || tooLarge}
            className="flex items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-[12px] text-bg transition-colors hover:opacity-90 disabled:opacity-30"
          >
            {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <textarea
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          setMessage(null);
          setError(null);
        }}
        disabled={loading}
        spellCheck={false}
        placeholder="Add instructions for compatible coding agents..."
        className="min-h-[240px] w-full resize-y rounded-lg border border-border bg-surface px-3 py-3 font-mono text-[13px] leading-5 text-fg outline-none transition-colors placeholder:text-subtle focus:border-border-strong disabled:opacity-50"
      />

      <div className="mt-2 flex items-center justify-between gap-4 text-[12px]">
        <div className={error ? "text-danger" : message ? "text-success" : "text-subtle"}>
          {error ??
            message ??
            (snapshot?.exists
              ? "Editing ~/.agents/AGENTS.md"
              : "Save to create ~/.agents/AGENTS.md")}
        </div>
        <div className={tooLarge ? "text-danger" : "text-subtle"}>
          {formatGlobalAgentInstructionsSize(byteLength)} /{" "}
          {formatGlobalAgentInstructionsSize(maxBytes)}
        </div>
      </div>
    </div>
  );
}

export async function readGlobalAgentInstructions(
  settingsApi: GlobalAgentInstructionsApi,
): Promise<GlobalAgentInstructionsSnapshot> {
  if (typeof settingsApi.readGlobalAgentInstructions !== "function") {
    throw new Error(
      "Global agent instructions support is not loaded. Restart Carrent and try again.",
    );
  }

  return settingsApi.readGlobalAgentInstructions();
}

export async function writeGlobalAgentInstructions(
  settingsApi: GlobalAgentInstructionsApi,
  content: string,
): Promise<GlobalAgentInstructionsSnapshot> {
  if (typeof settingsApi.writeGlobalAgentInstructions !== "function") {
    throw new Error(
      "Global agent instructions support is not loaded. Restart Carrent and try again.",
    );
  }

  return settingsApi.writeGlobalAgentInstructions(content);
}

/* -------------------------------------------------------------------------- */
/*  Section                                                                   */
/* -------------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border">
      <h2 className="py-4 text-[13px] font-medium text-muted">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Settings Page                                                             */
/* -------------------------------------------------------------------------- */

export function SettingsPage() {
  const { setActiveThreadId } = useWorkspace();
  const { autoDetectRuntimes, rtkEnabled, theme, fontSize, updateSetting } = useSettings();
  const [searchParams] = useSearchParams();
  const activeTabId = resolveSettingsTabId(searchParams.get("tab"));
  const activeTab = SETTINGS_TABS.find((tab) => tab.id === activeTabId) ?? SETTINGS_TABS[0];

  useEffect(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <header
        className="drag-region shrink-0"
        style={{ height: "env(titlebar-area-height, 38px)" }}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-2xl px-8 py-8">
          <div className="mb-8 flex items-center gap-2">
            <Settings className="h-5 w-5 text-subtle" />
            <h1 className="text-[18px] font-medium text-fg">{activeTab.label}</h1>
          </div>

          <div>
            {activeTabId === "runtime" ? (
              <Section title="Runtime">
                <RuntimeStatusPanel />
                <Toggle
                  label="Auto-detect runtimes"
                  description="Automatically detect installed runtimes on startup"
                  enabled={autoDetectRuntimes}
                  onChange={(value) => updateSetting("autoDetectRuntimes", value)}
                />
                <Toggle
                  label="RTK token optimization"
                  description="Ask all runtimes to use RTK for local development commands when available"
                  enabled={rtkEnabled}
                  onChange={(value) => updateSetting("rtkEnabled", value)}
                />
                {rtkEnabled ? <RtkStatsPanel /> : null}
              </Section>
            ) : null}

            {activeTabId === "personalization" ? (
              <Section title="Personalization">
                <GlobalAgentInstructionsPanel />
              </Section>
            ) : null}

            {activeTabId === "interface" ? (
              <Section title="Interface">
                <Select
                  label="Theme"
                  value={theme}
                  onChange={(value) => updateSetting("theme", value as "dark" | "light" | "system")}
                  options={[
                    { value: "dark", label: "Dark" },
                    { value: "light", label: "Light" },
                    { value: "system", label: "System" },
                  ]}
                />
                <Select
                  label="Font size"
                  value={String(fontSize)}
                  onChange={(value) =>
                    updateSetting("fontSize", Number(value) as 12 | 13 | 14 | 15 | 16)
                  }
                  options={[
                    { value: "12", label: "12px" },
                    { value: "13", label: "13px" },
                    { value: "14", label: "14px" },
                    { value: "15", label: "15px" },
                    { value: "16", label: "16px" },
                  ]}
                />
              </Section>
            ) : null}

            {activeTabId === "about" ? (
              <Section title="About">
                <Field label="Version" value="v0.1.0" />
                <CheckForUpdatesRow />
              </Section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
