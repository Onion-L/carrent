import { useEffect, useState, useRef } from "react";
import {
  Settings,
  RefreshCw,
  Download,
  ChevronDown,
  FileText,
  FolderOpen,
  Save,
} from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useSettings } from "../context/SettingsContext";
import { upsertRtkAgentsBlock, type RtkGainStats } from "../../shared/rtk";

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
            <h1 className="text-[18px] font-medium text-fg">Settings</h1>
          </div>

          <div className="space-y-8">
            <Section title="Runtime">
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

            <Section title="Personalization">
              <GlobalAgentInstructionsPanel />
            </Section>

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

            <Section title="About">
              <Field label="Version" value="v0.1.0" />
              <CheckForUpdatesRow />
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
