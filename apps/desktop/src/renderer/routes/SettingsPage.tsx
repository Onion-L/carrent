import { useEffect, useState, useRef } from "react";
import {
  Settings,
  RefreshCw,
  Download,
  ChevronDown,
  FileText,
  FolderOpen,
  Save,
  ExternalLink,
  Minus,
  Plus,
  Search,
  Trash2,
  Archive,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useThreadContent } from "../context/ThreadContentContext";
import { useAppState } from "../context/AppStateContext";
import { useSettings } from "../context/SettingsContext";
import { RTK_MD_CONTENT, upsertRtkAgentsBlock, type RtkGainStats } from "../../shared/rtk";
import type { RuntimeRecord } from "../../shared/runtimes";
import { resolveSettingsTabId, SETTINGS_TABS } from "../lib/settingsTabs";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, parseFontSizeInput, stepFontSize } from "../lib/fontSize";
import { RuntimeIcon } from "../components/RuntimeIcon";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useRuntimeModels } from "../hooks/useRuntimeModels";
import { useRuntimes } from "../hooks/useRuntimes";
import { formatAbsoluteTime } from "../lib/formatRelativeTime";
import { useToast } from "../components/toast/ToastContext";
import type { AppThreadRecord } from "../../shared/workspacePersistence";

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
        <div className="text-app-13 text-fg">{label}</div>
        {description && <div className="mt-0.5 text-app-12 text-subtle">{description}</div>}
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
        <div className="text-app-13 text-fg">{label}</div>
        {description && <div className="mt-0.5 text-app-12 text-subtle">{description}</div>}
      </div>
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-[140px] items-center justify-between rounded-md border border-border bg-surface px-3 py-1.5 text-left transition-colors hover:border-border-strong"
        >
          <span className="text-app-13 text-fg">{selected?.label ?? value}</span>
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
                  className={`flex w-full px-3 py-2 text-left text-app-13 transition-colors ${
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

function IntegerInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const nextValue = parseFontSizeInput(draft);
    if (nextValue === null) {
      setDraft(String(value));
      return;
    }
    onChange(nextValue);
  };

  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <label className="text-app-13 text-fg" htmlFor="font-size-input">
        {label}
      </label>
      <div className="flex min-h-8 w-[148px] shrink-0 items-stretch overflow-hidden rounded-md border border-border bg-surface transition-colors focus-within:border-border-strong">
        <button
          type="button"
          aria-label="Decrease font size"
          title="Decrease font size"
          disabled={value <= MIN_FONT_SIZE}
          onClick={() => onChange(stepFontSize(value, -1))}
          className="flex w-8 shrink-0 items-center justify-center border-r border-border text-subtle transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          id="font-size-input"
          className="min-w-0 flex-1 bg-transparent pl-2 text-center text-app-13 text-fg outline-none"
          inputMode="numeric"
          maxLength={2}
          value={draft}
          onBlur={commit}
          onChange={(event) => {
            const nextDraft = event.target.value;
            if (nextDraft === "" || /^\d+$/.test(nextDraft)) {
              const boundedDraft =
                nextDraft !== "" && Number(nextDraft) > MAX_FONT_SIZE
                  ? String(MAX_FONT_SIZE)
                  : nextDraft;
              setDraft(boundedDraft);
              const nextValue = parseFontSizeInput(boundedDraft);
              if (nextValue !== null) onChange(nextValue);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(String(value));
              event.currentTarget.blur();
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onChange(stepFontSize(value, -1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onChange(stepFontSize(value, 1));
            }
          }}
          aria-describedby="font-size-range"
        />
        <span className="flex items-center pr-2 text-app-12 text-subtle">px</span>
        <button
          type="button"
          aria-label="Increase font size"
          title="Increase font size"
          disabled={value >= MAX_FONT_SIZE}
          onClick={() => onChange(stepFontSize(value, 1))}
          className="flex w-8 shrink-0 items-center justify-center border-l border-border text-subtle transition-colors hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="sr-only" id="font-size-range">
        Integer from {MIN_FONT_SIZE} to {MAX_FONT_SIZE}
      </span>
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
        <div className="text-app-13 text-fg">{label}</div>
        {description && <div className="mt-0.5 text-app-12 text-subtle">{description}</div>}
      </div>
      <div className="shrink-0 text-app-13 text-muted">{value}</div>
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
        <div className="text-app-13 text-fg">Check for updates</div>
        {result && (
          <div className="mt-0.5 text-app-12 text-subtle">
            {result.hasUpdate ? `Update available: ${result.latestVersion}` : "Up to date"}
          </div>
        )}
      </div>
      <button
        onClick={handleCheck}
        disabled={checking}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
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
  const { runtimes, loading, refresh } = useRuntimes();
  const sortedRuntimes = [...runtimes].sort((a, b) => a.name.localeCompare(b.name));
  const kimiRuntime = sortedRuntimes.find((runtime) => runtime.id === "kimi");
  const canCheckKimi = kimiRuntime ? canCheckKimiConnection(kimiRuntime) : false;
  const { loading: kimiModelsLoading, refresh: refreshRuntimeModels } = useRuntimeModels(
    canCheckKimi ? "kimi" : null,
  );

  async function handleCheck(runtime: RuntimeRecord) {
    if (runtime.id === "kimi" && canCheckKimiConnection(runtime)) {
      await refreshRuntimeModels("kimi");
      return;
    }

    await refresh();
  }

  return (
    <div className="py-3.5">
      {loading && sortedRuntimes.length === 0 ? (
        <div className="flex min-h-16 items-center gap-3 border-y border-border py-3">
          <div className="h-8 w-8 shrink-0 rounded-lg bg-surface-raised" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-28 rounded bg-surface-raised" />
            <div className="h-2.5 w-16 rounded bg-surface-raised" />
          </div>
          <div className="h-8 w-20 rounded-md bg-surface-raised" />
          <div className="h-8 w-16 rounded-md bg-surface-raised" />
        </div>
      ) : sortedRuntimes.length > 0 ? (
        <div className="divide-y divide-border border-y border-border">
          {sortedRuntimes.map((runtime) => {
            const checking = loading || (runtime.id === "kimi" && kimiModelsLoading);

            return (
              <div
                key={runtime.id}
                className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 py-3"
              >
                <RuntimeIcon name={runtime.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-app-13 font-medium text-fg">{runtime.name}</h3>
                  <div className="mt-0.5 truncate font-mono text-app-11 text-subtle">
                    {getRuntimeVersionLabel(runtime)}
                  </div>
                  <KimiCliSetupNotice runtime={runtime} />
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleCheck(runtime)}
                    disabled={checking}
                    className="flex min-h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-app-12 text-bg transition-opacity hover:opacity-90 disabled:opacity-30"
                  >
                    <RefreshCw className={`h-3 w-3 ${checking ? "animate-spin" : ""}`} />
                    Check
                  </button>
                  {runtime.id === "kimi" ? (
                    <button
                      type="button"
                      onClick={() => window.open(KIMI_DOCS_URL, "_blank", "noopener,noreferrer")}
                      className="flex min-h-8 items-center gap-1.5 rounded-md px-3 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Docs
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function canCheckKimiConnection(
  runtime: Pick<RuntimeRecord, "id" | "availability" | "configuration">,
) {
  return (
    runtime.id === "kimi" &&
    runtime.availability === "detected" &&
    runtime.configuration === "configured"
  );
}

const KIMI_DOCS_URL = "https://moonshotai.github.io/kimi-code/en/guides/getting-started";

export function getRuntimeVersionLabel(
  runtime: Pick<RuntimeRecord, "id" | "availability" | "version">,
) {
  if (runtime.id === "kimi" && runtime.availability === "unavailable") {
    return "Not installed";
  }

  return runtime.version ?? "Unknown";
}

export function KimiCliSetupNotice({
  runtime,
}: {
  runtime: Pick<RuntimeRecord, "id" | "availability">;
}) {
  if (runtime.id !== "kimi" || runtime.availability !== "unavailable") {
    return null;
  }

  return (
    <p className="mt-1 text-app-11 leading-relaxed text-danger">
      Kimi CLI was not detected on this computer.{" "}
      <button
        type="button"
        onClick={() => window.open(KIMI_DOCS_URL, "_blank", "noopener,noreferrer")}
        className="underline underline-offset-2 transition-opacity hover:opacity-80"
      >
        Download and install Kimi Code
      </button>
      , then sign in before checking again.
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/*  RTK check panel                                                           */
/* -------------------------------------------------------------------------- */

const RTK_CHECK_RESULT_KEY = "carrent:rtk-check-result";

function loadRtkCheckResult(): RtkGainStats | null {
  try {
    const raw = localStorage.getItem(RTK_CHECK_RESULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RtkGainStats;
  } catch {
    return null;
  }
}

function saveRtkCheckResult(stats: RtkGainStats) {
  try {
    localStorage.setItem(RTK_CHECK_RESULT_KEY, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

function RtkCheckPanel() {
  const [checking, setChecking] = useState(false);
  const [stats, setStats] = useState<RtkGainStats | null>(loadRtkCheckResult);

  async function handleCheck() {
    setChecking(true);
    try {
      const result = await readRtkGainStats(window.carrent.settings);
      setStats(result);
      saveRtkCheckResult(result);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="py-3.5">
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="text-app-13 text-fg">RTK token optimization</div>
          <div className="mt-0.5 text-app-12 text-subtle">
            Check whether RTK is installed to view savings and add its instructions to AGENTS.md.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={checking}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
        >
          {checking ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
          {checking ? "Checking..." : "Check"}
        </button>
      </div>

      {stats?.available ? (
        <div className="mt-4">
          <RtkStatsPanel />
        </div>
      ) : stats ? (
        <div className="mt-4 text-app-12 text-subtle">RTK is not installed.</div>
      ) : null}
    </div>
  );
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
      const rtk = await writeGlobalRtkInstructions(window.carrent.settings, RTK_MD_CONTENT);
      const current = await readGlobalAgentInstructions(window.carrent.settings);
      const next = await writeGlobalAgentInstructions(
        window.carrent.settings,
        upsertRtkAgentsBlock(current.content, rtk.path),
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
          <div className="text-app-13 font-medium text-fg">Token optimization</div>
          <div className="mt-1 text-app-12 text-subtle">
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

      <div className="mt-4 text-app-12 text-muted">
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
          className={`min-w-0 text-app-12 ${
            agentsError ? "text-danger" : agentsMessage ? "text-success" : "text-subtle"
          }`}
        >
          {agentsError ?? agentsMessage ?? "Persist RTK as a global agent instruction."}
        </div>
        <button
          type="button"
          onClick={saveToAgents}
          disabled={agentsSaving}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
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
  writeGlobalRtkInstructions?: (content: string) => Promise<{ path: string; content: string }>;
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
    setError(null);
    try {
      await revealInFinder(window.carrent.shell, snapshot.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reveal the file in Finder.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="py-3.5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-app-13 text-fg">
            <FileText className="h-3.5 w-3.5 text-subtle" />
            Global agent instructions
          </div>
          <div className="mt-1 break-all text-app-12 text-subtle">
            {snapshot?.path ?? "~/.agents/AGENTS.md"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={openFile}
            disabled={!snapshot?.exists}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
          >
            <FolderOpen className="h-3 w-3" />
            Open
          </button>
          <button
            type="button"
            onClick={save}
            disabled={loading || saving}
            className="flex items-center gap-1.5 rounded-md bg-fg px-3 py-1.5 text-app-12 text-bg transition-colors hover:opacity-90 disabled:opacity-30"
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
        className="min-h-[240px] w-full resize-y rounded-lg border border-border bg-surface px-3 py-3 font-mono text-app-13 leading-5 text-fg outline-none transition-colors placeholder:text-subtle focus:border-border-strong disabled:opacity-50"
      />

      <div className="mt-2 text-app-12 text-subtle">
        {error ??
          message ??
          (snapshot?.exists ? "Editing ~/.agents/AGENTS.md" : "Save to create ~/.agents/AGENTS.md")}
      </div>
    </div>
  );
}

export async function writeGlobalRtkInstructions(
  settingsApi: GlobalAgentInstructionsApi,
  content: string,
): Promise<{ path: string; content: string }> {
  if (typeof settingsApi.writeGlobalRtkInstructions !== "function") {
    throw new Error(
      "Global RTK instructions support is not loaded. Restart Carrent and try again.",
    );
  }

  return settingsApi.writeGlobalRtkInstructions(content);
}

export async function revealInFinder(
  shellApi: { revealPath?: (filePath: string) => Promise<unknown> },
  filePath: string,
): Promise<void> {
  if (typeof shellApi.revealPath !== "function") {
    throw new Error("Reveal in Finder support is not loaded. Restart Carrent and try again.");
  }

  await shellApi.revealPath(filePath);
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
      <h2 className="py-4 text-app-13 font-medium text-muted">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Settings Page                                                             */
/* -------------------------------------------------------------------------- */

function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-app-12 text-muted transition-colors hover:border-border-strong hover:text-fg"
      >
        <span className="max-w-28 truncate">{selected?.label ?? value}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 max-h-64 w-44 overflow-auto rounded-md border border-border bg-surface shadow-lg shadow-black/10">
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full px-3 py-2 text-left text-app-12 transition-colors ${
                  isActive
                    ? "bg-surface-hover text-fg"
                    : "text-muted hover:bg-surface-raised hover:text-fg"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ArchivedThreadsPanel({
  threads,
  workspaces,
  projects,
  associations,
  restoreThread,
  permanentlyDeleteThread,
  deleteThreadContent,
}: {
  threads: AppThreadRecord[];
  workspaces: ReturnType<typeof useAppState>["workspaces"];
  projects: ReturnType<typeof useAppState>["projects"];
  associations: ReturnType<typeof useAppState>["associations"];
  restoreThread: ReturnType<typeof useAppState>["restoreThread"];
  permanentlyDeleteThread: ReturnType<typeof useAppState>["permanentlyDeleteThread"];
  deleteThreadContent: ReturnType<typeof useThreadContent>["deleteThread"];
}) {
  const { showToast } = useToast();
  const archivedThreads = [...threads]
    .filter((thread) => thread.archived)
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
  const [query, setQuery] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [confirmingThread, setConfirmingThread] = useState<AppThreadRecord | null>(null);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);

  const getWorkspaceName = (thread: AppThreadRecord) =>
    workspaces.find((item) => item.id === thread.workspaceId)?.name ?? "Unknown Workspace";
  const getProjectName = (thread: AppThreadRecord) => {
    const project = projects.find((item) => item.id === thread.projectId);
    const association = associations.find(
      (item) => item.workspaceId === thread.workspaceId && item.projectId === thread.projectId,
    );
    return association?.alias ?? project?.name ?? "Unknown Project";
  };
  const getPath = (thread: AppThreadRecord) =>
    `${getWorkspaceName(thread)} / ${getProjectName(thread)} / ${thread.title}`;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredThreads = archivedThreads.filter(
    (thread) =>
      (workspaceFilter === "all" || thread.workspaceId === workspaceFilter) &&
      (projectFilter === "all" || thread.projectId === projectFilter) &&
      (!normalizedQuery || getPath(thread).toLowerCase().includes(normalizedQuery)),
  );

  const orderedWorkspaces = [...workspaces].sort((left, right) => left.order - right.order);
  const groups = orderedWorkspaces
    .map((workspace) => ({
      workspace,
      threads: filteredThreads.filter((thread) => thread.workspaceId === workspace.id),
    }))
    .filter((group) => group.threads.length > 0);

  const workspaceOptions = [
    { value: "all", label: "All Workspaces" },
    ...orderedWorkspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })),
  ];
  const archivedProjectIds = new Set(archivedThreads.map((thread) => thread.projectId));
  const projectOptions = [
    { value: "all", label: "All Projects" },
    ...projects
      .filter((project) => archivedProjectIds.has(project.id))
      .map((project) => {
        const association = associations.find((item) => item.projectId === project.id);
        return { value: project.id, label: association?.alias ?? project.name };
      }),
  ];

  const handleRestore = async (thread: AppThreadRecord) => {
    if (pendingThreadId || isDeletingAll) return;
    setPendingThreadId(thread.id);
    const restored = await restoreThread(thread.id);
    setPendingThreadId(null);
    if (restored) {
      showToast(`"${thread.title}" was restored.`, "success");
    } else {
      showToast("Thread could not be restored.", "error");
    }
  };

  const handlePermanentDelete = async (thread: AppThreadRecord) => {
    setConfirmingThread(null);
    if (pendingThreadId || isDeletingAll) return;
    setPendingThreadId(thread.id);
    let deleted = false;
    try {
      deleted = await permanentlyDeleteThread(thread.id, async (appStateSnapshots) => {
        await deleteThreadContent(thread.id, appStateSnapshots);
      });
    } catch (deleteError) {
      console.error("[threads] permanent deletion rollback failed", deleteError);
    }
    setPendingThreadId(null);
    if (deleted) {
      showToast(`"${thread.title}" permanently deleted.`, "success");
    } else {
      showToast("Thread could not be permanently deleted.", "error");
    }
  };

  const handleDeleteAll = async () => {
    setConfirmingDeleteAll(false);
    if (isDeletingAll || archivedThreads.length === 0) return;
    setIsDeletingAll(true);
    const total = archivedThreads.length;
    let failed = 0;
    for (const thread of archivedThreads) {
      try {
        const deleted = await permanentlyDeleteThread(thread.id, async (appStateSnapshots) => {
          await deleteThreadContent(thread.id, appStateSnapshots);
        });
        if (!deleted) failed += 1;
      } catch (deleteError) {
        console.error("[threads] permanent deletion rollback failed", deleteError);
        failed += 1;
      }
    }
    setIsDeletingAll(false);
    if (failed === 0) {
      showToast(`Deleted ${total} archived ${total === 1 ? "Thread" : "Threads"}.`, "success");
    } else {
      showToast(`${failed} ${failed === 1 ? "Thread" : "Threads"} could not be deleted.`, "error");
    }
  };

  return (
    <>
      {archivedThreads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Archive className="h-6 w-6 text-subtle" />
          <p className="mt-3 text-app-13 font-medium text-muted">No archived threads</p>
          <p className="mt-1 text-app-12 text-subtle">Threads you archive will show up here.</p>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-4">
            <p className="text-app-12 text-subtle">
              {archivedThreads.length} {archivedThreads.length === 1 ? "Thread" : "Threads"}
            </p>
            <button
              type="button"
              disabled={isDeletingAll}
              onClick={() => setConfirmingDeleteAll(true)}
              className="flex items-center gap-1.5 text-app-12 font-medium text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete All
            </button>
          </div>

          <div className="mb-4 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search archived threads"
                aria-label="Search archived threads"
                className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-app-13 text-fg placeholder:text-subtle focus:border-border-strong focus:outline-none"
              />
            </div>
            <FilterSelect
              ariaLabel="Filter by Workspace"
              value={workspaceFilter}
              onChange={setWorkspaceFilter}
              options={workspaceOptions}
            />
            <FilterSelect
              ariaLabel="Filter by Project"
              value={projectFilter}
              onChange={setProjectFilter}
              options={projectOptions}
            />
          </div>

          {groups.length === 0 ? (
            <p className="py-10 text-center text-app-12 text-subtle">
              No threads match your search.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map(({ workspace, threads: groupThreads }) => (
                <div key={workspace.id} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                    <span className="truncate text-app-12 font-medium text-fg">
                      {workspace.name}
                    </span>
                    <span className="shrink-0 text-app-11 text-subtle">
                      {groupThreads.length} {groupThreads.length === 1 ? "Thread" : "Threads"}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {groupThreads.map((thread) => (
                      <div key={thread.id} className="flex items-center gap-3 px-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-app-13 font-medium text-fg">{thread.title}</p>
                          <p className="mt-0.5 truncate text-app-11 text-subtle">
                            {getProjectName(thread)} ·{" "}
                            {formatAbsoluteTime(Date.parse(thread.lastActivityAt))}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Permanently delete ${thread.title}`}
                          title="Permanently Delete"
                          disabled={pendingThreadId !== null || isDeletingAll}
                          onClick={() => setConfirmingThread(thread)}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={pendingThreadId !== null || isDeletingAll}
                          onClick={() => void handleRestore(thread)}
                          className="min-h-7 shrink-0 rounded-md border border-border-strong px-2.5 text-app-12 font-medium text-muted transition hover:bg-surface-hover hover:text-fg active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {confirmingThread ? (
        <ConfirmDialog
          title="Permanently Delete Thread?"
          message={`Permanently delete "${confirmingThread.title}" and all Carrent-owned history?`}
          confirmLabel="Delete"
          onCancel={() => setConfirmingThread(null)}
          onConfirm={() => void handlePermanentDelete(confirmingThread)}
        />
      ) : null}

      {confirmingDeleteAll ? (
        <ConfirmDialog
          title="Delete All Archived Threads?"
          message={`Permanently delete ${archivedThreads.length} archived ${archivedThreads.length === 1 ? "Thread" : "Threads"} and all Carrent-owned history?`}
          confirmLabel="Delete All"
          onCancel={() => setConfirmingDeleteAll(false)}
          onConfirm={() => void handleDeleteAll()}
        />
      ) : null}
    </>
  );
}

export function SettingsPage() {
  const { setSelectedThreadId, deleteThread: deleteThreadContent } = useThreadContent();
  const { workspaces, projects, associations, threads, restoreThread, permanentlyDeleteThread } =
    useAppState();
  const { autoDetectRuntimes, theme, fontSize, updateSetting } = useSettings();
  const [searchParams] = useSearchParams();
  const activeTabId = resolveSettingsTabId(searchParams.get("tab"));
  const activeTab = SETTINGS_TABS.find((tab) => tab.id === activeTabId) ?? SETTINGS_TABS[0];

  useEffect(() => {
    setSelectedThreadId(null);
  }, [setSelectedThreadId]);

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <header
        className="drag-region shrink-0"
        style={{ height: "env(titlebar-area-height, 38px)" }}
      />

      <div className="flex-1 overflow-auto">
        <div
          className={`mx-auto w-full px-8 py-8 ${
            activeTabId === "archives" ? "max-w-4xl" : "max-w-2xl"
          }`}
        >
          <div className="mb-8 flex items-center gap-2">
            <Settings className="h-5 w-5 text-subtle" />
            <h1 className="text-app-18 font-medium text-fg">{activeTab.label}</h1>
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
                <RtkCheckPanel />
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
                <IntegerInput
                  label="Font size"
                  value={fontSize}
                  onChange={(value) => updateSetting("fontSize", value)}
                />
              </Section>
            ) : null}

            {activeTabId === "archives" ? (
              <ArchivedThreadsPanel
                threads={threads}
                workspaces={workspaces}
                projects={projects}
                associations={associations}
                restoreThread={restoreThread}
                permanentlyDeleteThread={permanentlyDeleteThread}
                deleteThreadContent={deleteThreadContent}
              />
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
