import { Check, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Server, X } from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";

import type {
  ListProviderModelsRequest,
  ProviderModelInfo,
  ProviderProfileType,
} from "../../../shared/agentAuth";
import logoUrl from "../../assets/logo.png";
import { KimiLogo } from "./ProviderLogo";

export type NewProviderDraft = {
  type: ProviderProfileType;
  baseUrl: string;
  modelId: string;
  models: ProviderModelInfo[];
  apiKey: string;
};

type Preset = {
  key: string;
  label: string;
  type: ProviderProfileType;
  baseUrl: string;
  mode: "oauth" | "apiKey";
  icon: ComponentType<{ className?: string }>;
  description: string;
};

const PRESETS: Preset[] = [
  {
    key: "kimi",
    label: "Kimi Code",
    type: "kimi-coding",
    baseUrl: "https://api.kimi.com/coding",
    mode: "oauth",
    icon: KimiLogo,
    description: "Sign in with your Kimi Code account (OAuth).",
  },
  {
    key: "anthropic",
    label: "Anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    mode: "apiKey",
    icon: KeyRound,
    description: "Enter your Anthropic API key.",
  },
  {
    key: "custom",
    label: "Custom",
    type: "openai-compatible",
    baseUrl: "",
    mode: "apiKey",
    icon: Server,
    description: "Enter an API key for any OpenAI-compatible endpoint.",
  },
];

// The API-key configuration page defaults to the Custom preset.
const CONFIG_DEFAULT_PRESET = PRESETS.find((preset) => preset.key === "custom")!;

/**
 * Full-screen Add Provider flow: a variant-A-style option list — Kimi OAuth
 * sign-in or an API-key entry — followed by the API configuration form (API
 * key, endpoint with a preset dropdown, and a model list fetched from the
 * endpoint as checkboxes).
 */
export function AddProviderFlow({
  onCancel,
  onSubmit,
  onOAuthLogin,
}: {
  onCancel: () => void;
  onSubmit: (draft: NewProviderDraft) => Promise<void>;
  onOAuthLogin: () => Promise<void>;
}) {
  const [step, setStep] = useState<"select" | "configure">("select");
  const [preset, setPreset] = useState<Preset>(CONFIG_DEFAULT_PRESET);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(CONFIG_DEFAULT_PRESET.baseUrl);
  const [models, setModels] = useState<ProviderModelInfo[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [oauthPending, setOauthPending] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, submitting]);

  const openConfig = (next: Preset) => {
    setPreset(next);
    setBaseUrl(next.baseUrl);
    setModels(null);
    setListError(null);
    setStep("configure");
  };

  const startOAuth = async () => {
    if (oauthPending) return;
    setOauthPending(true);
    try {
      await onOAuthLogin();
    } catch {
      // The caller surfaces the error via toast.
    } finally {
      setOauthPending(false);
    }
  };

  const changePreset = (key: string) => {
    const next = PRESETS.find((candidate) => candidate.key === key);
    if (!next) return;
    setPreset(next);
    setBaseUrl(next.baseUrl);
    setModels(null);
    setListError(null);
  };

  const fetchModels = async () => {
    setListing(true);
    setListError(null);
    try {
      const request: ListProviderModelsRequest = {
        type: preset.type,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      };
      const list = await window.carrent.agentAuth.listModels(request);
      setModels(list);
      setChecked(new Set(list.map((model) => model.id)));
    } catch (error) {
      setModels(null);
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setListing(false);
    }
  };

  const toggleModel = (id: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedModels = (models ?? []).filter((model) => checked.has(model.id));
  const canContinue =
    apiKey.trim().length > 0 && baseUrl.trim().length > 0 && selectedModels.length > 0;

  const submit = async () => {
    if (!canContinue || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        type: preset.type,
        baseUrl: baseUrl.trim(),
        modelId: selectedModels[0]!.id,
        models: selectedModels,
        apiKey: apiKey.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-bg text-fg" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Exit"
        onClick={onCancel}
        style={{ top: "calc(env(titlebar-area-height, 38px) + 0.75rem)" }}
        className="no-drag absolute left-4 flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg"
      >
        <X className="h-4 w-4" />
      </button>

      {step === "select" ? (
        <main className="flex h-full w-full flex-col items-center justify-center overflow-y-auto px-4 py-10">
          <div className="flex w-full max-w-md flex-col items-center">
            <img src={logoUrl} alt="Carrent" className="h-12 w-12 rounded-xl" />
            <h1 className="mt-5 text-app-22 font-semibold">Add Provider</h1>
            <p className="mt-1.5 text-app-14 text-subtle">Select a connection method</p>
            <div className="mt-8 w-full space-y-2.5">
              {PRESETS.map((option) => {
                const pending = option.mode === "oauth" && oauthPending;
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={oauthPending}
                    onClick={() =>
                      option.mode === "oauth" ? void startOAuth() : openConfig(option)
                    }
                    className="flex w-full items-center gap-3.5 rounded-xl border border-border-strong bg-surface px-4 py-3.5 text-left transition hover:border-fg/20 hover:bg-surface-raised disabled:opacity-60"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
                      {pending ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted" />
                      ) : (
                        <option.icon className="h-5 w-5 text-muted" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-app-14 font-semibold text-fg">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-app-12 text-subtle">
                        {pending ? "Waiting for browser sign-in…" : option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      ) : (
        <main className="flex h-full w-full flex-col items-center justify-center overflow-y-auto px-4 py-10">
          <div className="w-full max-w-md">
            <h1 className="text-center text-app-18 font-semibold">API Configuration</h1>
            <p className="mt-1.5 text-center text-app-12 text-subtle">
              Pick a provider preset and enter your API key, then fetch the models the endpoint
              supports.
            </p>

            <label
              className="mt-7 block text-app-12 font-medium text-muted"
              htmlFor="add-provider-api-key"
            >
              API Key
            </label>
            <div className="relative mt-1.5">
              <input
                id="add-provider-api-key"
                type={showApiKey ? "text" : "password"}
                autoFocus
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={preset.key === "kimi" ? "sk-kimi-..." : "sk-..."}
                autoComplete="off"
                spellCheck={false}
                className="h-10 w-full rounded-md border border-border-strong bg-surface px-3 pr-10 text-app-14 text-fg outline-none transition focus-visible:ring-2 focus-visible:ring-fg/25"
              />
              <button
                type="button"
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
                onClick={() => setShowApiKey((current) => !current)}
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <label className="text-app-12 font-medium text-muted" htmlFor="add-provider-endpoint">
                Endpoint
              </label>
              <select
                aria-label="Provider preset"
                value={preset.key}
                onChange={(event) => changePreset(event.target.value)}
                className="min-h-8 rounded-md border border-border bg-surface px-2 text-app-12 text-fg outline-none transition hover:border-border-strong"
              >
                {PRESETS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <input
              id="add-provider-endpoint"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setModels(null);
              }}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              className="mt-1.5 h-10 w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-app-13 text-fg outline-none transition focus-visible:ring-2 focus-visible:ring-fg/25"
            />

            <button
              type="button"
              disabled={listing || !apiKey.trim() || !baseUrl.trim()}
              onClick={() => void fetchModels()}
              className="mt-5 flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-border-strong px-3 text-app-13 font-medium text-fg transition hover:bg-surface-hover disabled:opacity-40"
            >
              {listing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Fetch Model List
            </button>
            {listError && <p className="mt-2 text-app-12 text-danger">{listError}</p>}

            {models && (
              <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-border-strong bg-surface">
                {models.map((model) => {
                  const isChecked = checked.has(model.id);
                  return (
                    <label
                      key={model.id}
                      className="flex min-h-10 cursor-pointer items-center gap-3 border-b border-border px-3 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleModel(model.id)}
                        className="h-3.5 w-3.5 shrink-0 accent-fg"
                      />
                      <span className="min-w-0 flex-1 truncate text-app-13 text-fg">
                        {model.name}
                      </span>
                      {model.name !== model.id && (
                        <span className="shrink-0 font-mono text-app-11 text-subtle">
                          {model.id}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setStep("select")}
                className="min-h-10 flex-1 rounded-md border border-border-strong text-app-13 font-medium text-muted transition hover:bg-surface-hover hover:text-fg"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!canContinue || submitting}
                onClick={() => void submit()}
                className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md bg-fg text-app-13 font-medium text-bg transition hover:opacity-90 disabled:opacity-40"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Continue
              </button>
            </div>
          </div>
        </main>
      )}
    </div>,
    document.body,
  );
}
