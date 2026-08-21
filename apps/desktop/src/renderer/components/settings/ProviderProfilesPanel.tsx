import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, KeyRound, Loader2, LogIn, LogOut, Plus, X } from "lucide-react";

import type {
  AgentAuthView,
  ProviderProfileType,
  SaveAgentAuthRequest,
} from "../../../shared/agentAuth";
import { useToast } from "../toast/ToastContext";
import { AddProviderFlow, type NewProviderDraft } from "./AddProviderFlow";
import { ModelSelect } from "./ModelSelect";
import { ProviderLogo } from "./ProviderLogo";

type DraftProfile = SaveAgentAuthRequest["profiles"][number] & {
  hasApiKey: boolean;
  /** Id the profile was loaded with, to carry credentials over a rename. */
  originalId?: string;
};

function emptyProfile(index: number): DraftProfile {
  return {
    id: index === 0 ? "default" : `profile-${index + 1}`,
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    modelId: "claude-sonnet-4-6",
    thinking: false,
    apiKey: "",
    hasApiKey: false,
    oauthSupported: false,
    originalId: index === 0 ? "default" : undefined,
  };
}

/** A draft counts as configured when it holds (or keeps) any credential. */
function isDraftConfigured(profile: DraftProfile): boolean {
  return Boolean(profile.apiKey?.trim() || profile.hasApiKey || profile.authType);
}

const TYPE_LABELS: Record<ProviderProfileType, string> = {
  "kimi-coding": "Kimi Code",
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI 兼容",
};

function AuthStatus({ profile }: { profile: DraftProfile }) {
  if (profile.authType === "oauth") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-app-12 text-fg">
        <span className="h-1.5 w-1.5 rounded-full bg-success" /> OAuth 已连接
      </span>
    );
  }
  if (profile.authType === "api_key" || profile.hasApiKey) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-app-12 text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-fg/40" /> API Key
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-app-12 text-danger">
      <span className="h-1.5 w-1.5 rounded-full bg-danger" /> 未配置
    </span>
  );
}

export function ProviderProfilesPanel() {
  const { showToast } = useToast();
  const [path, setPath] = useState("~/.carrent/agent/auth.json");
  const [profiles, setProfiles] = useState<DraftProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [oauthProfileId, setOauthProfileId] = useState<string | null>(null);
  const [addingProvider, setAddingProvider] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const applyView = (view: AgentAuthView) => {
    const next = view.profiles.map((profile) => ({
      ...profile,
      apiKey: "",
      originalId: profile.id,
    }));
    setPath(view.path);
    setProfiles(next.length > 0 ? next : [emptyProfile(0)]);
    setActiveProfileId(view.activeProfileId || next[0]?.id || "default");
    // First run: open the placeholder row so the form is immediately visible.
    setExpandedId((current) => {
      if (current && next.some((profile) => profile.id === current)) return current;
      const only = next.length === 1 ? next[0] : undefined;
      return only && !isDraftConfigured(only) ? only.id : null;
    });
  };

  useEffect(() => {
    void window.carrent.agentAuth
      .load()
      .then(applyView)
      .catch((error) =>
        showToast(
          error instanceof Error ? error.message : "Provider Profiles could not be loaded.",
          "error",
        ),
      )
      .finally(() => setLoading(false));
  }, [showToast]);

  const updateProfile = (index: number, patch: Partial<DraftProfile>) => {
    setProfiles((current) =>
      current.map((profile, profileIndex) =>
        profileIndex === index ? { ...profile, ...patch } : profile,
      ),
    );
  };

  const toRequestProfile = ({
    hasApiKey: _hasApiKey,
    authType: _authType,
    oauthSupported: _oauthSupported,
    models: _models,
    originalId,
    ...profile
  }: DraftProfile): SaveAgentAuthRequest["profiles"][number] => ({
    ...profile,
    ...(profile.apiKey?.trim() ? { apiKey: profile.apiKey.trim() } : {}),
    ...(originalId && originalId !== profile.id ? { previousId: originalId } : {}),
  });

  const saveRequest = (): SaveAgentAuthRequest => ({
    activeProfileId,
    profiles: profiles.map(toRequestProfile),
  });

  const persist = async (request: SaveAgentAuthRequest): Promise<boolean> => {
    setSaving(true);
    try {
      applyView(await window.carrent.agentAuth.save(request));
      return true;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Provider Profiles could not be saved.",
        "error",
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  // A freshly connected provider takes over as active when the current active
  // profile has no credential yet (e.g. the first-run placeholder).
  const activateWhenActiveUnconfigured = (request: SaveAgentAuthRequest, id: string) => {
    const active = profiles.find((profile) => profile.id === activeProfileId);
    if (!active || !isDraftConfigured(active)) request.activeProfileId = id;
  };

  const addProvider = async (draft: NewProviderDraft) => {
    const baseId =
      draft.type === "kimi-coding" ? "kimi" : draft.type === "anthropic" ? "anthropic" : "custom";
    let id = baseId;
    let suffix = 2;
    while (profiles.some((profile) => profile.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const request = saveRequest();
    request.profiles.push({
      id,
      type: draft.type,
      baseUrl: draft.baseUrl,
      modelId: draft.modelId,
      thinking: false,
      apiKey: draft.apiKey,
      models: draft.models,
    });
    activateWhenActiveUnconfigured(request, id);
    if (await persist(request)) {
      showToast("Provider added.", "success");
      setAddingProvider(false);
    }
  };

  // The Kimi OAuth entry saves a fresh kimi-coding profile first (the login
  // IPC requires the profile to exist), then runs the browser OAuth flow.
  const loginWithKimiOAuth = async () => {
    let id = "kimi";
    let suffix = 2;
    while (profiles.some((profile) => profile.id === id)) {
      id = `kimi-${suffix}`;
      suffix += 1;
    }
    const request = saveRequest();
    request.profiles.push({
      id,
      type: "kimi-coding",
      baseUrl: "https://api.kimi.com/coding",
      modelId: "k3",
      thinking: false,
    });
    activateWhenActiveUnconfigured(request, id);
    try {
      applyView(await window.carrent.agentAuth.save(request));
      if (!window.carrent.agentAuth.login) throw new Error("OAuth login is not available.");
      applyView(await window.carrent.agentAuth.login(id));
      showToast("OAuth login completed.", "success");
      setAddingProvider(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "OAuth login failed.", "error");
      throw error;
    }
  };

  const loginWithOAuth = async (profileId: string) => {
    if (!window.carrent.agentAuth.login) return;
    setOauthProfileId(profileId);
    try {
      await window.carrent.agentAuth.save(saveRequest());
      applyView(await window.carrent.agentAuth.login(profileId));
      showToast("OAuth login completed.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "OAuth login failed.", "error");
    } finally {
      setOauthProfileId(null);
    }
  };

  const cancelLogin = async (profileId: string) => {
    await window.carrent.agentAuth.cancelLogin?.(profileId);
  };

  const logout = async (profileId: string) => {
    if (!window.carrent.agentAuth.logout) return;
    setOauthProfileId(profileId);
    try {
      applyView(await window.carrent.agentAuth.logout(profileId));
      showToast("OAuth disconnected.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "OAuth logout failed.", "error");
    } finally {
      setOauthProfileId(null);
    }
  };

  const setDefault = async (id: string) => {
    if (id === activeProfileId) return;
    setActiveProfileId(id);
    const request = saveRequest();
    request.activeProfileId = id;
    await persist(request);
  };

  const removeProfile = async (index: number) => {
    if (profiles.length <= 1) return;
    const target = profiles[index];
    const remaining = profiles.filter((_, profileIndex) => profileIndex !== index);
    const nextActive = activeProfileId === target?.id ? (remaining[0]?.id ?? "") : activeProfileId;
    setProfiles(remaining);
    setActiveProfileId(nextActive);
    setExpandedId(null);
    setConfirmingDeleteId(null);
    await persist({ activeProfileId: nextActive, profiles: remaining.map(toRequestProfile) });
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-app-13 text-subtle">Loading Provider Profiles...</div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <h2 className="text-app-14 font-semibold text-fg">Provider Profiles</h2>
          <p className="mt-1 truncate font-mono text-app-11 text-subtle" title={path}>
            {profiles.length} 个 Profile · {path}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddingProvider(true)}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md bg-fg px-2.5 text-app-12 font-medium text-bg transition-opacity hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Provider
        </button>
      </div>

      <div className="divide-y divide-border">
        {profiles.map((profile, index) => {
          const expanded = expandedId === profile.id;
          const active = profile.id === activeProfileId;
          return (
            <section key={`${profile.id}:${index}`}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  setExpandedId(expanded ? null : profile.id);
                  setConfirmingDeleteId(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpandedId(expanded ? null : profile.id);
                  }
                }}
                className={`flex cursor-pointer items-center gap-3 py-3.5 pr-2 transition-colors ${
                  expanded ? "" : "hover:bg-surface/60"
                }`}
              >
                <ProviderLogo type={profile.type} />
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
                    {TYPE_LABELS[profile.type]} · {profile.modelId}
                  </span>
                </span>
                <AuthStatus profile={profile} />
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-subtle transition-transform ${
                    expanded ? "rotate-180" : ""
                  }`}
                />
              </div>

              {expanded ? (
                <div className="mb-4 rounded-lg border border-border-strong bg-surface p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Profile ID">
                      <input
                        value={profile.id}
                        onChange={(event) => {
                          const previous = profile.id;
                          updateProfile(index, { id: event.target.value });
                          if (activeProfileId === previous) setActiveProfileId(event.target.value);
                          if (expandedId === previous) setExpandedId(event.target.value);
                        }}
                        className="field-input"
                        spellCheck={false}
                      />
                    </Field>
                    <Field label="Provider Type">
                      <select
                        value={profile.type}
                        onChange={(event) => {
                          const type = event.target.value as ProviderProfileType;
                          updateProfile(index, {
                            type,
                            ...(type === "kimi-coding"
                              ? {
                                  baseUrl: "https://api.kimi.com/coding",
                                  modelId: "k3",
                                  authType: undefined,
                                  hasApiKey: false,
                                  oauthSupported: true,
                                }
                              : type === "anthropic"
                                ? {
                                    baseUrl: "https://api.anthropic.com",
                                    modelId: "claude-sonnet-4-6",
                                    authType: undefined,
                                    hasApiKey: false,
                                    oauthSupported: false,
                                  }
                                : {
                                    authType: undefined,
                                    hasApiKey: false,
                                    oauthSupported: false,
                                    models: undefined,
                                  }),
                          });
                        }}
                        className="field-input"
                      >
                        <option value="anthropic">Anthropic</option>
                        <option value="kimi-coding">Kimi Coding</option>
                        <option value="openai-compatible">OpenAI-compatible</option>
                      </select>
                    </Field>
                    <Field label="Base URL" className="col-span-2">
                      <input
                        value={profile.baseUrl}
                        onChange={(event) => updateProfile(index, { baseUrl: event.target.value })}
                        className="field-input"
                        spellCheck={false}
                        placeholder="https://api.example.com/v1"
                      />
                    </Field>
                    <Field label="Model ID">
                      {profile.models?.length ? (
                        <ModelSelect
                          value={profile.modelId}
                          onChange={(modelId) => updateProfile(index, { modelId })}
                          models={profile.models}
                          placeholder="Select model"
                        />
                      ) : (
                        <input
                          value={profile.modelId}
                          onChange={(event) =>
                            updateProfile(index, { modelId: event.target.value })
                          }
                          className="field-input"
                          spellCheck={false}
                          placeholder="model-id"
                        />
                      )}
                    </Field>
                    <Field label="API Key">
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
                        <input
                          type="password"
                          value={profile.apiKey ?? ""}
                          onChange={(event) => updateProfile(index, { apiKey: event.target.value })}
                          className="field-input pl-8"
                          autoComplete="off"
                          placeholder={
                            profile.authType === "oauth"
                              ? "OAuth configured"
                              : profile.hasApiKey
                                ? "Configured - leave blank to keep"
                                : "Required"
                          }
                        />
                      </div>
                    </Field>
                    <label className="col-span-2 flex items-center gap-2 text-app-12 text-muted">
                      <input
                        type="checkbox"
                        checked={profile.thinking === true}
                        onChange={(event) =>
                          updateProfile(index, { thinking: event.target.checked })
                        }
                        className="h-3.5 w-3.5 accent-fg"
                      />
                      <span>Enable Thinking</span>
                    </label>
                    {profile.oauthSupported ? (
                      <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                        <span className="text-app-11 text-subtle">
                          {profile.authType === "oauth"
                            ? "Connected with OAuth"
                            : "Connect a Kimi Code account"}
                        </span>
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              void (oauthProfileId === profile.id
                                ? cancelLogin(profile.id)
                                : loginWithOAuth(profile.id))
                            }
                            disabled={oauthProfileId !== null && oauthProfileId !== profile.id}
                            className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-40"
                          >
                            {oauthProfileId === profile.id ? (
                              <X className="h-3.5 w-3.5" />
                            ) : (
                              <LogIn className="h-3.5 w-3.5" />
                            )}
                            {oauthProfileId === profile.id
                              ? "Cancel"
                              : profile.authType === "oauth"
                                ? "Sign in again"
                                : "Sign in with OAuth"}
                          </button>
                          {profile.authType === "oauth" ? (
                            <button
                              type="button"
                              aria-label={`Disconnect ${profile.id}`}
                              onClick={() => void logout(profile.id)}
                              disabled={oauthProfileId !== null}
                              className="flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                              title="Disconnect OAuth"
                            >
                              <LogOut className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                    {active ? (
                      <span className="text-app-11 text-subtle">当前默认 Profile</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void setDefault(profile.id)}
                        className="min-h-8 rounded-md border border-border px-2.5 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
                      >
                        设为默认
                      </button>
                    )}
                    <span className="flex items-center gap-1.5">
                      {profiles.length > 1 ? (
                        confirmingDeleteId === profile.id ? (
                          <span className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void removeProfile(index)}
                              className="min-h-8 rounded-md bg-danger px-2.5 text-app-12 font-medium text-white transition hover:opacity-90"
                            >
                              确认删除
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(null)}
                              className="min-h-8 rounded-md px-2 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(profile.id)}
                            className="min-h-8 rounded-md border border-border px-2.5 text-app-12 text-muted transition hover:bg-danger/10 hover:text-danger"
                          >
                            删除
                          </button>
                        )
                      ) : null}
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void persist(saveRequest())}
                        className="flex min-h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-app-12 font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        {saving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        保存
                      </button>
                    </span>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {addingProvider && (
        <AddProviderFlow
          onCancel={() => setAddingProvider(false)}
          onSubmit={addProvider}
          onOAuthLogin={loginWithKimiOAuth}
        />
      )}
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
    <label className={`min-w-0 ${className}`}>
      <span className="mb-1.5 block text-app-11 font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
