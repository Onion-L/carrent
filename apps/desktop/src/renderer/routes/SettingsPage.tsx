import { useEffect, useState } from "react";
import { Settings, RefreshCw, Download, ChevronDown } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useSettings } from "../context/SettingsContext";

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
        <div className="text-[13px] text-[#ccc]">{label}</div>
        {description && (
          <div className="mt-0.5 text-[12px] text-[#555]">{description}</div>
        )}
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${
          enabled ? "bg-[#e0e0e0]" : "bg-[#333]"
        }`}
        aria-label={label}
      >
        <span
          className={`absolute left-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-[#111] transition-transform ${
            enabled ? "translate-x-[12px]" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Select                                                                    */
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
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13px] text-[#ccc]">{label}</div>
        {description && (
          <div className="mt-0.5 text-[12px] text-[#555]">{description}</div>
        )}
      </div>
      <div className="relative shrink-0">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none rounded-md border border-white/[0.06] bg-[#1a1a1a] py-1.5 pr-7 pl-3 text-[13px] text-[#ccc] outline-none transition-colors hover:border-white/[0.10] focus:border-white/[0.14]"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2 text-[#555]" />
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
        <div className="text-[13px] text-[#ccc]">{label}</div>
        {description && (
          <div className="mt-0.5 text-[12px] text-[#555]">{description}</div>
        )}
      </div>
      <div className="shrink-0 text-[13px] text-[#888]">{value}</div>
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
        <div className="text-[13px] text-[#ccc]">Check for updates</div>
        {result && (
          <div className="mt-0.5 text-[12px] text-[#555]">
            {result.hasUpdate
              ? `Update available: ${result.latestVersion}`
              : "Up to date"}
          </div>
        )}
      </div>
      <button
        onClick={handleCheck}
        disabled={checking}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/[0.06] bg-[#1a1a1a] px-3 py-1.5 text-[12px] text-[#888] transition-colors hover:border-white/[0.10] hover:text-[#ccc] disabled:opacity-40"
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
/*  Section                                                                   */
/* -------------------------------------------------------------------------- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-white/[0.04]">
      <h2 className="py-4 text-[13px] font-medium text-[#888]">{title}</h2>
      <div className="divide-y divide-white/[0.04]">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Settings Page                                                             */
/* -------------------------------------------------------------------------- */

export function SettingsPage() {
  const { setActiveThreadId } = useWorkspace();
  const { autoDetectRuntimes, theme, fontSize, updateSetting } = useSettings();

  useEffect(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);

  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-[#111]">
      <div className="mx-auto w-full max-w-2xl px-8 py-8">
        {/* Header */}
        <div className="drag-region mb-8 flex items-center gap-2">
          <Settings className="h-5 w-5 text-[#666]" />
          <h1 className="text-[18px] font-medium text-[#e0e0e0]">Settings</h1>
        </div>

        <div className="space-y-8">
          <Section title="Runtime">
            <Toggle
              label="Auto-detect runtimes"
              description="Automatically detect installed runtimes on startup"
              enabled={autoDetectRuntimes}
              onChange={(value) => updateSetting("autoDetectRuntimes", value)}
            />
          </Section>

          <Section title="Interface">
            <Select
              label="Theme"
              value={theme}
              onChange={(value) =>
                updateSetting("theme", value as "dark" | "light" | "system")
              }
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
                { value: "12", label: "Small" },
                { value: "13", label: "13px" },
                { value: "14", label: "Default" },
                { value: "15", label: "15px" },
                { value: "16", label: "Large" },
              ]}
            />
          </Section>

          <Section title="About">
            <Field label="Version" value="v0.1.0" />
            <Field label="Electron" value={window.carrent.electronVersion} />
            <CheckForUpdatesRow />
          </Section>
        </div>
      </div>
    </div>
  );
}
