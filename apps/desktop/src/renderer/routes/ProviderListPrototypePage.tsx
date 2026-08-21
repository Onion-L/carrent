// PROTOTYPE — throwaway. Not for production.
// Question: Settings 的 Providers 标签页改成什么样？Add Provider 已走全屏页，
// 这里只需要 profile 列表 + 编辑入口。三个变体，?variant= 切换，
// 路由 /prototype/provider-list。数据全部 mock；操作只改内存状态。
// 底部左侧常驻当前 mock 状态，方便核对每次操作的结果。Wipe freely.

import { Check, ChevronDown, Pencil, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

// ---------------------------------------------------------------------------
// Mock store
// ---------------------------------------------------------------------------

type ProfileType = "kimi-coding" | "anthropic" | "openai-compatible";

type MockProfile = {
  id: string;
  type: ProfileType;
  baseUrl: string;
  modelId: string;
  thinking: boolean;
  authType?: "oauth" | "api_key";
};

const INITIAL_PROFILES: MockProfile[] = [
  {
    id: "kimi",
    type: "kimi-coding",
    baseUrl: "https://api.kimi.com/coding",
    modelId: "k3",
    thinking: false,
    authType: "oauth",
  },
  {
    id: "anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    modelId: "claude-sonnet-4-6",
    thinking: true,
    authType: "api_key",
  },
  {
    id: "openrouter",
    type: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "deepseek/deepseek-chat-v3.1",
    thinking: false,
    authType: "api_key",
  },
  {
    id: "vllm-local",
    type: "openai-compatible",
    baseUrl: "http://127.0.0.1:8000/v1",
    modelId: "Qwen/Qwen3-Coder-30B",
    thinking: false,
  },
];

const TYPE_META: Record<ProfileType, { label: string; letter: string; color: string }> = {
  "kimi-coding": { label: "Kimi Code", letter: "K", color: "text-[#1783FF] bg-[#1783FF]/10" },
  anthropic: { label: "Anthropic", letter: "A", color: "text-[#D97757] bg-[#D97757]/10" },
  "openai-compatible": {
    label: "OpenAI 兼容",
    letter: "O",
    color: "text-emerald-600 bg-emerald-500/10",
  },
};

function AuthStatus({ authType }: { authType?: MockProfile["authType"] }) {
  if (authType === "oauth") {
    return (
      <span className="inline-flex items-center gap-1.5 text-app-12 text-fg">
        <span className="h-1.5 w-1.5 rounded-full bg-success" /> OAuth 已连接
      </span>
    );
  }
  if (authType === "api_key") {
    return (
      <span className="inline-flex items-center gap-1.5 text-app-12 text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-fg/40" /> API Key
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-app-12 text-danger">
      <span className="h-1.5 w-1.5 rounded-full bg-danger" /> 未配置
    </span>
  );
}

function Avatar({ type, size = "h-8 w-8 text-app-13" }: { type: ProfileType; size?: string }) {
  const meta = TYPE_META[type];
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg font-semibold ${meta.color} ${size}`}
    >
      {meta.letter}
    </span>
  );
}

function useProfileStore() {
  const [profiles, setProfiles] = useState<MockProfile[]>(INITIAL_PROFILES);
  const [activeId, setActiveId] = useState("kimi");

  const update = (id: string, patch: Partial<MockProfile>) => {
    setProfiles((current) =>
      current.map((profile) => (profile.id === id ? { ...profile, ...patch } : profile)),
    );
  };
  const remove = (id: string) => {
    setProfiles((current) => current.filter((profile) => profile.id !== id));
    setActiveId((current) =>
      current === id ? (profiles.find((p) => p.id !== id)?.id ?? "") : current,
    );
  };

  return { profiles, activeId, setActiveId, update, remove };
}

type Store = ReturnType<typeof useProfileStore>;

// Rule 5: surface the state — every action is visible here.
function StatePeek({ store }: { store: Store }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-50 rounded-full border border-border-strong bg-surface-raised px-3 py-1.5 text-app-11 text-subtle shadow-2xl transition hover:text-fg"
      >
        状态
      </button>
    );
  }
  return (
    <div className="fixed bottom-5 left-5 z-50 w-72 rounded-xl border border-border-strong bg-surface-raised p-3 shadow-2xl">
      <div className="flex items-center justify-between">
        <p className="text-app-11 font-medium text-subtle">MOCK 状态</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-0.5 text-subtle transition hover:bg-surface-hover hover:text-fg"
          aria-label="收起状态"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <p className="mt-1 font-mono text-app-11 text-fg">active: {store.activeId || "—"}</p>
      <ul className="mt-1 space-y-0.5">
        {store.profiles.map((profile) => (
          <li key={profile.id} className="truncate font-mono text-app-11 text-muted">
            {profile.id} · {profile.authType ?? "none"} · {profile.modelId}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared edit form body (fields only; each variant wraps it differently)
// ---------------------------------------------------------------------------

function EditFields({
  draft,
  onChange,
}: {
  draft: MockProfile;
  onChange(patch: Partial<MockProfile>): void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldLabel label="Base URL" className="col-span-2">
        <input
          value={draft.baseUrl}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
          spellCheck={false}
          className={inputClass}
        />
      </FieldLabel>
      <FieldLabel label="Model ID">
        <input
          value={draft.modelId}
          onChange={(event) => onChange({ modelId: event.target.value })}
          spellCheck={false}
          className={inputClass}
        />
      </FieldLabel>
      <FieldLabel label="认证">
        <div className="flex h-10 items-center text-app-13 text-muted">
          {draft.authType === "oauth"
            ? "OAuth 登录"
            : draft.authType === "api_key"
              ? "API Key 已保存"
              : "未配置"}
        </div>
      </FieldLabel>
      <label className="col-span-2 flex items-center gap-2 text-app-12 text-muted">
        <input
          type="checkbox"
          checked={draft.thinking}
          onChange={(event) => onChange({ thinking: event.target.checked })}
          className="h-3.5 w-3.5 accent-fg"
        />
        Enable Thinking
      </label>
    </div>
  );
}

function FieldLabel({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block text-app-11 font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded-md border border-border-strong bg-surface-raised px-3 text-app-13 text-fg outline-none transition focus-visible:ring-2 focus-visible:ring-fg/25";

function DeleteButton({
  confirming,
  onAsk,
  onConfirm,
  onCancel,
}: {
  confirming: boolean;
  onAsk(): void;
  onConfirm(): void;
  onCancel(): void;
}) {
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={onAsk}
        className="min-h-8 rounded-md border border-border px-2.5 text-app-12 text-muted transition hover:bg-danger/10 hover:text-danger"
      >
        删除
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        onClick={onConfirm}
        className="min-h-8 rounded-md bg-danger px-2.5 text-app-12 font-medium text-white transition hover:opacity-90"
      >
        确认删除
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-8 rounded-md px-2 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
      >
        取消
      </button>
    </span>
  );
}

function PageHeader({ count, onAdd }: { count: number; onAdd(): void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
      <div className="min-w-0">
        <h2 className="text-app-14 font-semibold text-fg">Provider Profiles</h2>
        <p className="mt-1 text-app-11 text-subtle">
          {count} 个 Profile · 连接与配置在 Add Provider 页完成
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md bg-fg px-2.5 text-app-12 font-medium text-bg transition-opacity hover:opacity-90"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Provider
      </button>
    </div>
  );
}

function addNote() {
  // 占位：真实实现里这里打开 AddProviderFlow 全屏页。
  window.alert("PROTOTYPE: 这里会进入 Add Provider 全屏连接页");
}

// ---------------------------------------------------------------------------
// Variant A — 行列表 + 行内展开编辑
// ---------------------------------------------------------------------------

function VariantA({ store }: { store: Store }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MockProfile | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const toggle = (profile: MockProfile) => {
    if (expandedId === profile.id) {
      setExpandedId(null);
      setDraft(null);
      return;
    }
    setExpandedId(profile.id);
    setDraft(profile);
    setConfirmingId(null);
  };

  return (
    <main className="flex h-full w-full justify-center overflow-y-auto bg-bg px-6 py-8 text-fg">
      <div className="w-full max-w-3xl">
        <PageHeader count={store.profiles.length} onAdd={addNote} />

        <div className="divide-y divide-border border-b border-border">
          {store.profiles.map((profile) => {
            const expanded = expandedId === profile.id;
            const active = store.activeId === profile.id;
            return (
              <section key={profile.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(profile)}
                  onKeyDown={(event) => event.key === "Enter" && toggle(profile)}
                  className={`flex cursor-pointer items-center gap-3 py-3.5 pr-2 transition-colors ${
                    expanded ? "" : "hover:bg-surface/60"
                  }`}
                >
                  <Avatar type={profile.type} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-app-13 font-medium text-fg">{profile.id}</span>
                      {active ? (
                        <span className="rounded-full bg-fg/10 px-1.5 py-0.5 text-app-10 font-medium text-fg">
                          默认
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-app-12 text-subtle">
                      {TYPE_META[profile.type].label} · {profile.modelId}
                    </span>
                  </span>
                  <AuthStatus authType={profile.authType} />
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-subtle transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </div>

                {expanded && draft ? (
                  <div className="mb-4 rounded-lg border border-border-strong bg-surface p-4">
                    <EditFields
                      draft={draft}
                      onChange={(patch) => setDraft({ ...draft, ...patch })}
                    />
                    <div className="mt-4 flex items-center justify-between gap-2">
                      {!active ? (
                        <button
                          type="button"
                          onClick={() => store.setActiveId(profile.id)}
                          className="min-h-8 rounded-md border border-border px-2.5 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
                        >
                          设为默认
                        </button>
                      ) : (
                        <span />
                      )}
                      <span className="flex items-center gap-1.5">
                        <DeleteButton
                          confirming={confirmingId === profile.id}
                          onAsk={() => setConfirmingId(profile.id)}
                          onCancel={() => setConfirmingId(null)}
                          onConfirm={() => {
                            store.remove(profile.id);
                            setExpandedId(null);
                            setDraft(null);
                            setConfirmingId(null);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (draft) store.update(profile.id, draft);
                            setExpandedId(null);
                            setDraft(null);
                          }}
                          className="flex min-h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-app-12 font-medium text-bg transition-opacity hover:opacity-90"
                        >
                          <Check className="h-3.5 w-3.5" /> 保存
                        </button>
                      </span>
                    </div>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Variant B — 左侧列表 + 右侧详情/编辑面板
// ---------------------------------------------------------------------------

function VariantB({ store }: { store: Store }) {
  const [selectedId, setSelectedId] = useState(store.profiles[0]?.id ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MockProfile | null>(null);
  const [confirming, setConfirming] = useState(false);

  const selected = store.profiles.find((profile) => profile.id === selectedId);

  const pick = (id: string) => {
    setSelectedId(id);
    setEditing(false);
    setDraft(null);
    setConfirming(false);
  };

  return (
    <main className="flex h-full w-full justify-center overflow-y-auto bg-bg px-6 py-8 text-fg">
      <div className="w-full max-w-4xl">
        <PageHeader count={store.profiles.length} onAdd={addNote} />

        <div className="mt-5 flex items-stretch gap-5">
          <aside className="w-56 shrink-0 space-y-1">
            {store.profiles.map((profile) => {
              const isSelected = profile.id === selectedId;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => pick(profile.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
                    isSelected ? "bg-surface-hover" : "hover:bg-surface"
                  }`}
                >
                  <Avatar type={profile.type} size="h-7 w-7 text-app-12" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-app-13 font-medium text-fg">
                      {profile.id}
                    </span>
                    <span className="block truncate text-app-11 text-subtle">
                      {TYPE_META[profile.type].label}
                    </span>
                  </span>
                  {store.activeId === profile.id ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg" title="默认" />
                  ) : null}
                </button>
              );
            })}
          </aside>

          {selected ? (
            <section className="min-w-0 flex-1 rounded-xl border border-border-strong bg-surface p-5">
              <div className="flex items-center gap-3">
                <Avatar type={selected.type} size="h-10 w-10 text-app-15" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-app-14 font-semibold text-fg">{selected.id}</p>
                  <p className="text-app-12 text-subtle">{TYPE_META[selected.type].label}</p>
                </div>
                {store.activeId === selected.id ? (
                  <span className="rounded-full bg-fg/10 px-2 py-0.5 text-app-11 font-medium text-fg">
                    默认
                  </span>
                ) : null}
              </div>

              {editing && draft ? (
                <div className="mt-5">
                  <EditFields
                    draft={draft}
                    onChange={(patch) => setDraft({ ...draft, ...patch })}
                  />
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setDraft(null);
                      }}
                      className="min-h-8 rounded-md px-3 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        store.update(selected.id, draft);
                        setEditing(false);
                        setDraft(null);
                      }}
                      className="flex min-h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-app-12 font-medium text-bg transition-opacity hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" /> 保存
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <dl className="mt-5 space-y-2.5">
                    <Row label="端点" value={selected.baseUrl} mono />
                    <Row label="模型" value={selected.modelId} mono />
                    <Row label="Thinking" value={selected.thinking ? "开启" : "关闭"} />
                    <Row label="认证" value={<AuthStatus authType={selected.authType} />} />
                  </dl>
                  <div className="mt-5 flex items-center justify-between gap-2 border-t border-border pt-4">
                    {store.activeId === selected.id ? (
                      <span />
                    ) : (
                      <button
                        type="button"
                        onClick={() => store.setActiveId(selected.id)}
                        className="min-h-8 rounded-md border border-border px-2.5 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
                      >
                        设为默认
                      </button>
                    )}
                    <span className="flex items-center gap-1.5">
                      <DeleteButton
                        confirming={confirming}
                        onAsk={() => setConfirming(true)}
                        onCancel={() => setConfirming(false)}
                        onConfirm={() => {
                          const nextId = store.profiles.find((p) => p.id !== selected.id)?.id ?? "";
                          store.remove(selected.id);
                          pick(nextId);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(selected);
                          setEditing(true);
                        }}
                        className="flex min-h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-app-12 font-medium text-bg transition-opacity hover:opacity-90"
                      >
                        <Pencil className="h-3.5 w-3.5" /> 编辑
                      </button>
                    </span>
                  </div>
                </>
              )}
            </section>
          ) : (
            <section className="flex min-w-0 flex-1 items-center justify-center rounded-xl border border-dashed border-border-strong text-app-13 text-subtle">
              选择一个 Profile
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-app-12 text-subtle">{label}</dt>
      <dd
        className={`min-w-0 truncate text-right text-app-13 text-fg ${mono ? "font-mono text-app-12" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant C — 紧凑表格 + 弹窗编辑
// ---------------------------------------------------------------------------

function VariantC({ store }: { store: Store }) {
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MockProfile | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const editing = store.profiles.find((profile) => profile.id === editId);

  return (
    <main className="flex h-full w-full justify-center overflow-y-auto bg-bg px-6 py-8 text-fg">
      <div className="w-full max-w-4xl">
        <PageHeader count={store.profiles.length} onAdd={addNote} />

        <table className="mt-5 w-full border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-app-11 uppercase tracking-wide text-subtle">
              <th className="border-b border-border pb-2 pl-1 font-medium">名称</th>
              <th className="border-b border-border pb-2 font-medium">模型</th>
              <th className="border-b border-border pb-2 font-medium">认证</th>
              <th className="border-b border-border pb-2 font-medium">默认</th>
              <th className="border-b border-border pb-2 pr-1 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {store.profiles.map((profile) => (
              <tr key={profile.id} className="group">
                <td className="border-b border-border py-3 pl-1">
                  <span className="flex items-center gap-2.5">
                    <Avatar type={profile.type} size="h-7 w-7 text-app-12" />
                    <span className="min-w-0">
                      <span className="block truncate text-app-13 font-medium text-fg">
                        {profile.id}
                      </span>
                      <span className="block truncate text-app-11 text-subtle">
                        {TYPE_META[profile.type].label}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="max-w-40 truncate border-b border-border py-3 pr-4 font-mono text-app-12 text-muted">
                  {profile.modelId}
                </td>
                <td className="border-b border-border py-3 pr-4">
                  <AuthStatus authType={profile.authType} />
                </td>
                <td className="border-b border-border py-3 pr-4">
                  <button
                    type="button"
                    aria-label={`设 ${profile.id} 为默认`}
                    onClick={() => store.setActiveId(profile.id)}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                      store.activeId === profile.id
                        ? "border-fg bg-fg text-bg"
                        : "border-border text-transparent hover:border-border-strong"
                    }`}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                </td>
                <td className="border-b border-border py-3 pr-1 text-right">
                  <span className="inline-flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label={`编辑 ${profile.id}`}
                      onClick={() => {
                        setDraft(profile);
                        setEditId(profile.id);
                        setConfirmingId(null);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <DeleteButton
                      confirming={confirmingId === profile.id}
                      onAsk={() => setConfirmingId(profile.id)}
                      onCancel={() => setConfirmingId(null)}
                      onConfirm={() => {
                        store.remove(profile.id);
                        setConfirmingId(null);
                      }}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {editing && draft ? (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-6"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              setEditId(null);
              setDraft(null);
            }}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-border-strong bg-surface p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <Avatar type={editing.type} />
                <p className="flex-1 text-app-14 font-semibold text-fg">{editing.id}</p>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={() => {
                    setEditId(null);
                    setDraft(null);
                  }}
                  className="rounded-md p-1.5 text-subtle transition hover:bg-surface-hover hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4">
                <EditFields draft={draft} onChange={(patch) => setDraft({ ...draft, ...patch })} />
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditId(null);
                    setDraft(null);
                  }}
                  className="min-h-8 rounded-md px-3 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    store.update(editing.id, draft);
                    setEditId(null);
                    setDraft(null);
                  }}
                  className="flex min-h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-app-12 font-medium text-bg transition-opacity hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" /> 保存
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Switcher + page
// ---------------------------------------------------------------------------

const VARIANTS = [
  { key: "A", name: "行列表展开", Component: VariantA },
  { key: "B", name: "主从分栏", Component: VariantB },
  { key: "C", name: "表格弹窗", Component: VariantC },
] as const;

export function ProviderListPrototypePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const variantParam = searchParams.get("variant") ?? "A";
  const currentIndex = Math.max(
    0,
    VARIANTS.findIndex((variant) => variant.key === variantParam),
  );
  const current = VARIANTS[currentIndex];
  const store = useProfileStore();

  const cycle = useCallback(
    (direction: 1 | -1) => {
      const next = VARIANTS[(currentIndex + direction + VARIANTS.length) % VARIANTS.length];
      setSearchParams({ variant: next.key }, { replace: true });
    },
    [currentIndex, setSearchParams],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cycle]);

  const { Component } = current;

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <h1 className="text-app-15 font-semibold text-fg">Providers</h1>
        <p className="text-app-12 text-subtle">管理已连接的模型提供商</p>
      </div>
      <div className="min-h-0 flex-1">
        <Component key={current.key} store={store} />
      </div>
      {import.meta.env.DEV && <StatePeek store={store} />}
      {import.meta.env.DEV && (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border-strong bg-surface-raised px-1.5 py-1.5 shadow-2xl">
          <button
            type="button"
            aria-label="上一个变体"
            onClick={() => cycle(-1)}
            className="rounded-full px-3 py-1 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
          >
            ←
          </button>
          <span className="min-w-32 text-center text-app-12 font-medium text-fg">
            {current.key} — {current.name}
          </span>
          <button
            type="button"
            aria-label="下一个变体"
            onClick={() => cycle(1)}
            className="rounded-full px-3 py-1 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
