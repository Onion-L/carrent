import { useEffect, useState, useRef } from "react";
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
        <div className="text-[13px] text-[#ccc]">{label}</div>
        {description && (
          <div className="mt-0.5 text-[12px] text-[#555]">{description}</div>
        )}
      </div>
      <div ref={ref} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-[140px] items-center justify-between rounded-md border border-white/[0.06] bg-[#1a1a1a] px-3 py-1.5 text-left transition-colors hover:border-white/[0.10]"
        >
          <span className="text-[13px] text-[#ccc]">
            {selected?.label ?? value}
          </span>
          <ChevronDown
            className={`h-3 w-3 shrink-0 text-[#555] transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-10 mt-1 w-[140px] overflow-hidden rounded-md border border-white/[0.06] bg-[#1a1a1a] shadow-lg shadow-black/30">
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
                      ? "bg-white/[0.05] text-[#e0e0e0]"
                      : "text-[#ccc] hover:bg-white/[0.03]"
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
        className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] text-[#888] transition-colors hover:bg-white/[0.04] hover:text-[#ccc] disabled:opacity-30"
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
  );
}
