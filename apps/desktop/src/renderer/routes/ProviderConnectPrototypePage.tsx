// PROTOTYPE — throwaway. Not for production.
// Question: what should the first-run "connect a provider" page look like?
// Three variants of the provider-connect page, switchable via ?variant=,
// on the throwaway route /prototype/provider-connect. All data is mock;
// "connect" only surfaces the SaveAgentAuthRequest-shaped payload. Wipe freely.

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  LogIn,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import logoUrl from "../assets/logo.png";
import { AddProviderFlow, type NewProviderDraft } from "../components/settings/AddProviderFlow";

// Variant REAL previews the shipped AddProviderFlow with a stubbed bridge so
// it renders in a plain browser dev server (no Electron preload).
(window as unknown as { carrent?: unknown }).carrent ??= {
  agentAuth: {
    listModels: async () => [
      { id: "k3", name: "Kimi K3" },
      { id: "k2-thinking", name: "Kimi K2 Thinking" },
      { id: "k2", name: "Kimi K2" },
    ],
  },
};

function VariantReal() {
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState<NewProviderDraft | null>(null);
  return (
    <div className="flex h-full w-full items-center justify-center bg-sidebar text-fg">
      <p className="text-app-13 text-subtle">Settings · Providers（背景占位）</p>
      {open && (
        <AddProviderFlow
          onCancel={() => setOpen(false)}
          onSubmit={async (draft) => {
            setSaved(draft);
            setOpen(false);
          }}
          onOAuthLogin={async () => {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            setSaved({
              type: "kimi-coding",
              baseUrl: "https://api.kimi.com/coding",
              modelId: "k3",
              models: [],
              apiKey: "(oauth)",
            });
            setOpen(false);
          }}
        />
      )}
      {saved && (
        <pre className="absolute bottom-20 left-1/2 max-h-64 w-[560px] -translate-x-1/2 overflow-auto rounded-lg border border-border-strong bg-surface p-4 font-mono text-app-12 text-muted">
          {JSON.stringify(saved, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

type ProviderType = "kimi-coding" | "anthropic" | "openai-compatible";

const PROVIDER_PRESETS: Record<ProviderType, { baseUrl: string; modelId: string }> = {
  "kimi-coding": { baseUrl: "https://api.kimi.com/coding", modelId: "k3" },
  anthropic: { baseUrl: "https://api.anthropic.com", modelId: "claude-sonnet-4-6" },
  "openai-compatible": { baseUrl: "", modelId: "" },
};

function useMockConnection() {
  const [type, setType] = useState<ProviderType | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [oauthPending, setOauthPending] = useState(false);
  const [connected, setConnected] = useState<Record<string, unknown> | null>(null);

  const pick = (next: ProviderType) => {
    setType(next);
    setBaseUrl(PROVIDER_PRESETS[next].baseUrl);
    setModelId(PROVIDER_PRESETS[next].modelId);
    setConnected(null);
  };

  const payload = (): Record<string, unknown> => ({
    activeProfileId: "default",
    profiles: [
      {
        id: "default",
        type,
        baseUrl,
        modelId,
        thinking: false,
        ...(type === "kimi-coding" ? { authType: "oauth" } : { apiKey: apiKey ? "••••••••" : "" }),
      },
    ],
  });

  // OAuth flow is simulated: pending for a moment, then the payload surfaces.
  const loginWithOAuth = () => {
    setOauthPending(true);
    setTimeout(() => {
      setOauthPending(false);
      setConnected(payload());
    }, 1200);
  };

  const connectWithApiKey = () => setConnected(payload());

  const reset = () => {
    setType(null);
    setApiKey("");
    setBaseUrl("");
    setModelId("");
    setOauthPending(false);
    setConnected(null);
  };

  return {
    type,
    pick,
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
    modelId,
    setModelId,
    oauthPending,
    loginWithOAuth,
    connectWithApiKey,
    connected,
    reset,
  };
}

type MockConnection = ReturnType<typeof useMockConnection>;

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Logo({ className }: { className?: string }) {
  return <img src={logoUrl} alt="Carrent" className={className ?? "h-12 w-12 rounded-xl"} />;
}

// Rule 5 of the prototype skill: surface the state. After "connect", render the
// exact payload the real agentAuth.save call would receive.
function ConnectedState({
  connected,
  onReset,
}: {
  connected: Record<string, unknown> | null;
  onReset(): void;
}) {
  if (!connected) return null;
  return (
    <div className="mt-6 w-full rounded-lg border border-border-strong bg-surface p-4 text-left">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-app-13 font-medium text-success">
          <Check className="h-4 w-4" /> agentAuth.save 将收到：
        </p>
        <button
          type="button"
          onClick={onReset}
          className="min-h-7 rounded-md px-2 text-app-12 font-medium text-muted transition hover:bg-surface-hover hover:text-fg"
        >
          重置
        </button>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md bg-bg p-3 font-mono text-app-12 text-muted">
        {JSON.stringify(connected, null, 2)}
      </pre>
    </div>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block text-app-12 font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-border-strong bg-surface-raised px-3 text-app-14 text-fg outline-none transition focus-visible:ring-2 focus-visible:ring-fg/25";

// The credential form shared by all three variants — OAuth button for
// kimi-coding, API key (+baseUrl/model) for the rest. Mirrors the real
// ProviderProfilesPanel field semantics.
function CredentialFields({ mock }: { mock: MockConnection }) {
  if (!mock.type) return null;

  if (mock.type === "kimi-coding") {
    return (
      <div>
        <button
          type="button"
          disabled={mock.oauthPending}
          onClick={mock.loginWithOAuth}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-fg px-3 text-app-14 font-medium text-bg transition hover:opacity-90 disabled:opacity-50"
        >
          {mock.oauthPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
          {mock.oauthPending ? "等待浏览器授权…" : "使用 Kimi Code 账号登录"}
        </button>
        <p className="mt-2 text-center text-app-11 text-subtle">
          将打开浏览器完成 OAuth 授权，令牌保存在本地。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {mock.type === "openai-compatible" && (
        <>
          <Field label="Base URL">
            <input
              value={mock.baseUrl}
              onChange={(event) => mock.setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              spellCheck={false}
              className={inputClass}
            />
          </Field>
          <Field label="Model ID">
            <input
              value={mock.modelId}
              onChange={(event) => mock.setModelId(event.target.value)}
              placeholder="model-id"
              spellCheck={false}
              className={inputClass}
            />
          </Field>
        </>
      )}
      <Field label="API Key">
        <input
          type="password"
          value={mock.apiKey}
          onChange={(event) => mock.setApiKey(event.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          className={inputClass}
        />
      </Field>
      <button
        type="button"
        disabled={
          !mock.apiKey || (mock.type === "openai-compatible" && (!mock.baseUrl || !mock.modelId))
        }
        onClick={mock.connectWithApiKey}
        className="min-h-10 w-full rounded-md bg-fg px-3 text-app-14 font-medium text-bg transition hover:opacity-90 disabled:opacity-40"
      >
        连接
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant A — 选项列表（参考图同款：居中 logo + 标题 + 连接方式行列表）
// ---------------------------------------------------------------------------

const VARIANT_A_OPTIONS = [
  {
    key: "kimi-coding" as const,
    icon: Sparkles,
    title: "Kimi Code 订阅",
    description: "使用 Kimi Code 账号 OAuth 登录，开箱即用。",
  },
  {
    key: "anthropic" as const,
    icon: KeyRound,
    title: "Anthropic API Key",
    description: "使用你自己的 Anthropic API Key 连接。",
  },
  {
    key: "openai-compatible" as const,
    icon: Server,
    title: "OpenAI 兼容服务",
    description: "OpenRouter、vLLM 或任何兼容 OpenAI 的端点。",
  },
];

function VariantA({ mock }: { mock: MockConnection }) {
  return (
    <main className="flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-bg px-4 py-10 text-fg">
      <div className="flex w-full max-w-md flex-col items-center">
        <Logo />
        <h1 className="mt-5 text-app-22 font-semibold">欢迎使用 Carrent</h1>
        <p className="mt-1.5 text-app-14 text-subtle">选择连接方式</p>

        <div className="mt-8 w-full space-y-2.5">
          {VARIANT_A_OPTIONS.map((option) => {
            const selected = mock.type === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => mock.pick(option.key)}
                className={`flex w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition ${
                  selected
                    ? "border-fg/40 bg-surface-raised"
                    : "border-border-strong bg-surface hover:border-fg/20 hover:bg-surface-raised"
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover">
                  <option.icon className="h-5 w-5 text-muted" />
                </span>
                <span className="min-w-0">
                  <span className="block text-app-14 font-semibold text-fg">{option.title}</span>
                  <span className="mt-0.5 block text-app-12 text-subtle">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        {mock.type && !mock.connected && (
          <div className="mt-6 w-full rounded-xl border border-border-strong bg-surface p-4">
            <CredentialFields mock={mock} />
          </div>
        )}

        <ConnectedState connected={mock.connected} onReset={mock.reset} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Variant B — 左右分栏（左侧品牌/说明，右侧分段选择器 + 凭据表单）
// ---------------------------------------------------------------------------

const VARIANT_B_POINTS = [
  { icon: ShieldCheck, text: "密钥与令牌只保存在本地 ~/.carrent/agent/auth.json" },
  { icon: KeyRound, text: "支持多个 Provider Profile，随时在设置中切换" },
  { icon: Server, text: "Anthropic、Kimi Code，或任何 OpenAI 兼容端点" },
] as const;

const VARIANT_B_TYPES = [
  { key: "kimi-coding" as const, label: "Kimi Code" },
  { key: "anthropic" as const, label: "Anthropic" },
  { key: "openai-compatible" as const, label: "OpenAI 兼容" },
] as const;

function VariantB({ mock }: { mock: MockConnection }) {
  return (
    <main className="flex h-full w-full bg-bg text-fg">
      <aside className="relative hidden w-[42%] flex-col justify-between overflow-hidden border-r border-border bg-sidebar p-10 md:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-fg/5 blur-3xl"
        />
        <Logo />
        <div className="relative">
          <h1 className="text-app-32 font-semibold leading-tight">连接你的模型</h1>
          <p className="mt-3 max-w-sm text-app-14 leading-6 text-muted">
            Carrent 需要至少一个模型提供商才能开始对话。选一种连接方式，一分钟完成。
          </p>
          <ul className="mt-8 space-y-4">
            {VARIANT_B_POINTS.map((point) => (
              <li key={point.text} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-hover">
                  <point.icon className="h-4 w-4 text-muted" />
                </span>
                <span className="text-app-13 leading-5 text-muted">{point.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-app-11 text-subtle">Carrent · 本地优先的 Agent 工作台</p>
      </aside>

      <section className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 md:hidden">
            <Logo />
          </div>
          <h2 className="text-app-22 font-semibold">接入 Provider</h2>
          <p className="mt-1.5 text-app-13 text-subtle">之后可以在设置里添加更多 Profile。</p>

          <div className="mt-7 grid grid-cols-3 gap-2">
            {VARIANT_B_TYPES.map((option) => {
              const selected = mock.type === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => mock.pick(option.key)}
                  className={`min-h-10 rounded-md border text-app-13 font-medium transition ${
                    selected
                      ? "border-fg/40 bg-surface-raised text-fg"
                      : "border-border-strong text-muted hover:bg-surface-hover hover:text-fg"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            {mock.type ? (
              <CredentialFields mock={mock} />
            ) : (
              <p className="rounded-md border border-dashed border-border-strong px-4 py-8 text-center text-app-13 text-subtle">
                先在上面选择一个提供商
              </p>
            )}
          </div>

          <ConnectedState connected={mock.connected} onReset={mock.reset} />
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Variant C — 分步向导（选择提供商 → 凭据 → 确认）
// ---------------------------------------------------------------------------

const VARIANT_C_STEPS = ["提供商", "凭据", "确认"] as const;

const VARIANT_C_TYPE_LABELS: Record<ProviderType, string> = {
  "kimi-coding": "Kimi Code 订阅",
  anthropic: "Anthropic API Key",
  "openai-compatible": "OpenAI 兼容服务",
};

function VariantC({ mock }: { mock: MockConnection }) {
  const [step, setStep] = useState(0);

  const credentialsReady =
    mock.type === "kimi-coding" ||
    (mock.apiKey.length > 0 &&
      (mock.type === "anthropic" || (mock.baseUrl.length > 0 && mock.modelId.length > 0)));

  return (
    <main className="flex h-full w-full items-center justify-center overflow-y-auto bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center">
          <Logo className="h-10 w-10 rounded-lg" />
          <h1 className="mt-4 text-app-18 font-semibold">接入你的第一个 Provider</h1>
        </div>

        <ol className="mt-6 flex items-center justify-center gap-2">
          {VARIANT_C_STEPS.map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-app-11 font-medium ${
                  index < step
                    ? "bg-success/20 text-success"
                    : index === step
                      ? "bg-fg text-bg"
                      : "bg-surface-hover text-subtle"
                }`}
              >
                {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span
                className={`text-app-12 ${index === step ? "font-medium text-fg" : "text-subtle"}`}
              >
                {label}
              </span>
              {index < VARIANT_C_STEPS.length - 1 && <span className="h-px w-8 bg-border-strong" />}
            </li>
          ))}
        </ol>

        <div className="mt-6 rounded-lg border border-border-strong bg-surface p-5">
          {step === 0 && (
            <div className="space-y-2.5">
              {VARIANT_A_OPTIONS.map((option) => {
                const selected = mock.type === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => mock.pick(option.key)}
                    className={`flex w-full items-center gap-3.5 rounded-lg border px-4 py-3 text-left transition ${
                      selected
                        ? "border-fg/40 bg-surface-raised"
                        : "border-border-strong hover:border-fg/20 hover:bg-surface-raised"
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-hover">
                      <option.icon className="h-5 w-5 text-muted" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-app-13 font-semibold text-fg">
                        {option.title}
                      </span>
                      <span className="mt-0.5 block text-app-12 text-subtle">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && <CredentialFields mock={mock} />}

          {step === 2 && (
            <div>
              <p className="text-app-13 font-medium text-fg">确认一下</p>
              <dl className="mt-3 space-y-2.5">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-app-12 text-subtle">提供商</dt>
                  <dd className="text-app-13 font-medium text-fg">
                    {mock.type ? VARIANT_C_TYPE_LABELS[mock.type] : "—"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-app-12 text-subtle">认证方式</dt>
                  <dd className="text-app-13 text-fg">
                    {mock.type === "kimi-coding" ? "OAuth 登录" : "API Key"}
                  </dd>
                </div>
                {mock.type === "openai-compatible" && (
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-app-12 text-subtle">端点</dt>
                    <dd className="truncate text-right font-mono text-app-12 text-fg">
                      {mock.baseUrl} · {mock.modelId}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <button
              type="button"
              disabled={step === 0}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              className="flex min-h-9 items-center gap-1 rounded-md px-3 text-app-13 font-medium text-muted transition enabled:hover:bg-surface-hover enabled:hover:text-fg disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" /> 上一步
            </button>
            {step < VARIANT_C_STEPS.length - 1 ? (
              <button
                type="button"
                disabled={(step === 0 && !mock.type) || (step === 1 && !credentialsReady)}
                onClick={() => setStep((current) => current + 1)}
                className="flex min-h-9 items-center gap-1 rounded-md bg-fg px-4 text-app-13 font-medium text-bg transition hover:opacity-90 disabled:opacity-40"
              >
                下一步 <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={mock.type === "kimi-coding" ? mock.loginWithOAuth : mock.connectWithApiKey}
                className="flex min-h-9 items-center gap-1.5 rounded-md bg-fg px-4 text-app-13 font-medium text-bg transition hover:opacity-90"
              >
                <Sparkles className="h-4 w-4" /> 完成接入
              </button>
            )}
          </div>
        </div>

        <ConnectedState connected={mock.connected} onReset={mock.reset} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Variant D — 卡片网格（大卡片并排，凭据表单直接在选中卡片内展开）
// ---------------------------------------------------------------------------

function VariantD({ mock }: { mock: MockConnection }) {
  return (
    <main className="flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-bg px-6 py-10 text-fg">
      <div className="w-full max-w-4xl">
        <div className="flex flex-col items-center">
          <Logo />
          <h1 className="mt-5 text-app-22 font-semibold">欢迎使用 Carrent</h1>
          <p className="mt-1.5 text-app-14 text-subtle">选择一种连接方式，凭据直接填在卡片里</p>
        </div>

        <div className="mt-8 grid items-start gap-4 md:grid-cols-3">
          {VARIANT_A_OPTIONS.map((option) => {
            const selected = mock.type === option.key;
            return (
              <div
                key={option.key}
                className={`rounded-xl border p-5 transition ${
                  selected
                    ? "border-fg/40 bg-surface-raised"
                    : "border-border-strong bg-surface hover:border-fg/20"
                }`}
              >
                <button
                  type="button"
                  onClick={() => mock.pick(option.key)}
                  className="w-full text-left"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-hover">
                    <option.icon className="h-5 w-5 text-muted" />
                  </span>
                  <span className="mt-3 block text-app-15 font-semibold text-fg">
                    {option.title}
                  </span>
                  <span className="mt-1 block text-app-12 leading-5 text-subtle">
                    {option.description}
                  </span>
                </button>
                {selected && !mock.connected && (
                  <div className="mt-4 border-t border-border pt-4">
                    <CredentialFields mock={mock} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <ConnectedState connected={mock.connected} onReset={mock.reset} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Variant E — 命令面板（⌘K 风格：搜索过滤 + 键盘上下选择 + 回车进入凭据）
// ---------------------------------------------------------------------------

function VariantE({ mock }: { mock: MockConnection }) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const filtered = VARIANT_A_OPTIONS.filter(
    (option) =>
      option.title.toLowerCase().includes(query.toLowerCase()) ||
      option.key.toLowerCase().includes(query.toLowerCase()),
  );
  const clampedHighlight = Math.min(highlight, Math.max(0, filtered.length - 1));

  return (
    <main className="flex h-full w-full flex-col items-center overflow-y-auto bg-bg px-4 pt-28 text-fg">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-3">
          <Logo className="h-8 w-8 rounded-lg" />
          <div>
            <h1 className="text-app-14 font-semibold">接入 Provider</h1>
            <p className="text-app-11 text-subtle">↑↓ 选择，回车确认，全程不用鼠标</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl">
          {!mock.type ? (
            <>
              <div className="flex items-center gap-2.5 border-b border-border px-4">
                <Search className="h-4 w-4 shrink-0 text-subtle" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlight(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setHighlight((current) => Math.min(filtered.length - 1, current + 1));
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlight((current) => Math.max(0, current - 1));
                    }
                    if (event.key === "Enter" && filtered[clampedHighlight]) {
                      mock.pick(filtered[clampedHighlight].key);
                    }
                  }}
                  placeholder="搜索提供商…"
                  spellCheck={false}
                  className="h-12 w-full bg-transparent text-app-14 text-fg outline-none placeholder:text-subtle"
                />
              </div>
              <div className="p-1.5">
                {filtered.length === 0 && (
                  <p className="px-3 py-6 text-center text-app-12 text-subtle">没有匹配的提供商</p>
                )}
                {filtered.map((option, index) => (
                  <button
                    key={option.key}
                    type="button"
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => mock.pick(option.key)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                      index === clampedHighlight ? "bg-surface-hover" : ""
                    }`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-raised">
                      <option.icon className="h-4 w-4 text-muted" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-app-13 font-medium text-fg">{option.title}</span>
                      <span className="block truncate text-app-11 text-subtle">
                        {option.description}
                      </span>
                    </span>
                    {index === clampedHighlight && (
                      <kbd className="rounded border border-border-strong bg-bg px-1.5 py-0.5 text-app-10 text-subtle">
                        ⏎
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="p-4">
              <button
                type="button"
                onClick={mock.reset}
                className="mb-3 flex items-center gap-1 text-app-12 font-medium text-muted transition hover:text-fg"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> 重新选择
              </button>
              <CredentialFields mock={mock} />
            </div>
          )}
        </div>

        <ConnectedState connected={mock.connected} onReset={mock.reset} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Variant F — 对话引导（一问一答聊天气泡，把接入过程变成对话）
// ---------------------------------------------------------------------------

function VariantF({ mock }: { mock: MockConnection }) {
  return (
    <main className="flex h-full w-full flex-col items-center overflow-y-auto bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center">
          <Logo className="h-10 w-10 rounded-lg" />
          <h1 className="mt-4 text-app-18 font-semibold">欢迎使用 Carrent</h1>
        </div>

        <div className="mt-8 space-y-4">
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-border-strong bg-surface px-4 py-3">
            <p className="text-app-13 text-fg">开始之前，先接入一个模型提供商。想用哪种方式？</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {VARIANT_A_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  disabled={mock.type !== null}
                  onClick={() => mock.pick(option.key)}
                  className="min-h-8 rounded-full border border-border-strong px-3 text-app-12 font-medium text-fg transition hover:bg-surface-hover disabled:opacity-50"
                >
                  {option.title}
                </button>
              ))}
            </div>
          </div>

          {mock.type && (
            <>
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-fg px-4 py-3">
                <p className="text-app-13 text-bg">{VARIANT_C_TYPE_LABELS[mock.type]}</p>
              </div>
              <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-border-strong bg-surface px-4 py-3">
                <p className="text-app-13 text-fg">
                  {mock.type === "kimi-coding"
                    ? "好选择。点下面的按钮，在浏览器里完成授权就行。"
                    : mock.type === "anthropic"
                      ? "把你的 Anthropic API Key 贴进来，只保存在本地。"
                      : "填上兼容端点的地址、模型和 API Key。"}
                </p>
                {!mock.connected && (
                  <div className="mt-3">
                    <CredentialFields mock={mock} />
                  </div>
                )}
              </div>
            </>
          )}

          {mock.connected && (
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-success/30 bg-success/10 px-4 py-3">
              <p className="flex items-center gap-2 text-app-13 font-medium text-success">
                <Check className="h-4 w-4" /> 接好了，可以开始对话了。
              </p>
            </div>
          )}
        </div>

        <ConnectedState connected={mock.connected} onReset={mock.reset} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Switcher + page
// ---------------------------------------------------------------------------

const VARIANTS = [
  { key: "A", name: "选项列表", Component: VariantA },
  { key: "B", name: "左右分栏", Component: VariantB },
  { key: "C", name: "分步向导", Component: VariantC },
  { key: "D", name: "卡片网格", Component: VariantD },
  { key: "E", name: "命令面板", Component: VariantE },
  { key: "F", name: "对话引导", Component: VariantF },
  { key: "REAL", name: "实装预览", Component: VariantReal },
] as const;

function PrototypeSwitcher({
  current,
  onCycle,
}: {
  current: (typeof VARIANTS)[number];
  onCycle(direction: 1 | -1): void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") onCycle(-1);
      if (event.key === "ArrowRight") onCycle(1);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCycle]);

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border-strong bg-surface-raised px-1.5 py-1.5 shadow-2xl">
      <button
        type="button"
        aria-label="上一个变体"
        onClick={() => onCycle(-1)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-fg"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-32 text-center text-app-12 font-medium text-fg">
        {current.key} — {current.name}
      </span>
      <button
        type="button"
        aria-label="下一个变体"
        onClick={() => onCycle(1)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-fg"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ProviderConnectPrototypePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const variantParam = searchParams.get("variant") ?? "A";
  const currentIndex = Math.max(
    0,
    VARIANTS.findIndex((variant) => variant.key === variantParam),
  );
  const current = VARIANTS[currentIndex];
  const mock = useMockConnection();

  const cycle = useCallback(
    (direction: 1 | -1) => {
      const next = VARIANTS[(currentIndex + direction + VARIANTS.length) % VARIANTS.length];
      setSearchParams({ variant: next.key }, { replace: true });
    },
    [currentIndex, setSearchParams],
  );

  const { Component } = current;

  return (
    <div className="h-screen w-screen">
      <Component key={current.key} mock={mock} />
      {import.meta.env.DEV && <PrototypeSwitcher current={current} onCycle={cycle} />}
    </div>
  );
}
