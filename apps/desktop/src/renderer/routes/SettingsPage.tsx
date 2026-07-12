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
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useWorkspace } from "../context/WorkspaceContext";
import { useSettings } from "../context/SettingsContext";
import { upsertRtkAgentsBlock, type RtkGainStats } from "../../shared/rtk";
import type { RuntimeRecord } from "../../shared/runtimes";
import { resolveSettingsTabId, SETTINGS_TABS } from "../lib/settingsTabs";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, parseFontSizeInput, stepFontSize } from "../lib/fontSize";
import { RuntimeIcon } from "../components/RuntimeIcon";
import { useRuntimeModels } from "../hooks/useRuntimeModels";
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
                    {runtime.version ?? "Unknown"}
                  </div>
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
            disabled={loading || saving || tooLarge}
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

      <div className="mt-2 flex items-center justify-between gap-4 text-app-12">
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
      <h2 className="py-4 text-app-13 font-medium text-muted">{title}</h2>
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
                <IntegerInput
                  label="Font size"
                  value={fontSize}
                  onChange={(value) => updateSetting("fontSize", value)}
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
