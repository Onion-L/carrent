import { useEffect, useState, type ReactNode } from "react";
import { Check, KeyRound, LogIn, LogOut, Plus, RefreshCw, Trash2, X } from "lucide-react";

import type {
  AgentAuthView,
  ProviderProfileType,
  SaveAgentAuthRequest,
} from "../../../shared/agentAuth";
import { useToast } from "../toast/ToastContext";
import { AddProviderFlow, type NewProviderDraft } from "./AddProviderFlow";

type DraftProfile = SaveAgentAuthRequest["profiles"][number] & { hasApiKey: boolean };

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
  };
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

  const applyView = (view: AgentAuthView) => {
    const next = view.profiles.map((profile) => ({ ...profile, apiKey: "" }));
    setPath(view.path);
    setProfiles(next.length > 0 ? next : [emptyProfile(0)]);
    setActiveProfileId(view.activeProfileId || next[0]?.id || "default");
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

  const saveRequest = (): SaveAgentAuthRequest => ({
    activeProfileId,
    profiles: profiles.map(
      ({
        hasApiKey: _hasApiKey,
        authType: _authType,
        oauthSupported: _oauthSupported,
        models: _models,
        ...profile
      }) => ({
        ...profile,
        ...(profile.apiKey?.trim() ? { apiKey: profile.apiKey.trim() } : {}),
      }),
    ),
  });

  // The Add Provider flow saves immediately: existing drafts (which never
  // carry a model selection, preserving stored ones on the main process) plus
  // the new profile with its fetched models and API key.
  const addProvider = async (draft: NewProviderDraft) => {
    const baseId = draft.type === "kimi-coding" ? "kimi" : "custom";
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
    if (!request.activeProfileId) request.activeProfileId = id;
    setSaving(true);
    try {
      applyView(await window.carrent.agentAuth.save(request));
      showToast("Provider added.", "success");
      setAddingProvider(false);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "The provider could not be added.",
        "error",
      );
      throw error;
    } finally {
      setSaving(false);
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
    if (!request.activeProfileId) request.activeProfileId = id;
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

  const save = async () => {
    setSaving(true);
    try {
      const view = await window.carrent.agentAuth.save(saveRequest());
      applyView(view);
      showToast("Provider Profiles saved.", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Provider Profiles could not be saved.",
        "error",
      );
    } finally {
      setSaving(false);
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

  if (loading) {
    return (
      <div className="py-12 text-center text-app-13 text-subtle">Loading Provider Profiles...</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0">
          <h2 className="text-app-14 font-semibold text-fg">Provider Profiles</h2>
          <p className="mt-1 truncate font-mono text-app-11 text-subtle" title={path}>
            {path}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddingProvider(true)}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-app-12 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Provider
        </button>
      </div>

      <div className="divide-y divide-border border-y border-border">
        {profiles.map((profile, index) => {
          const active = profile.id === activeProfileId;
          return (
            <section key={`${profile.id}:${index}`} className="py-5">
              <div className="mb-4 flex items-center gap-3">
                <button
                  type="button"
                  aria-label={`Use ${profile.id}`}
                  onClick={() => setActiveProfileId(profile.id)}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    active
                      ? "border-fg bg-fg text-bg"
                      : "border-border text-transparent hover:border-border-strong"
                  }`}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-app-13 font-medium text-fg">{profile.id}</span>
                    {active ? <span className="text-app-11 text-subtle">Active</span> : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${profile.id}`}
                  disabled={profiles.length === 1}
                  onClick={() => {
                    const next = profiles.filter((_, profileIndex) => profileIndex !== index);
                    setProfiles(next);
                    if (active) setActiveProfileId(next[0]?.id ?? "");
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Profile ID">
                  <input
                    value={profile.id}
                    onChange={(event) => {
                      const previous = profile.id;
                      updateProfile(index, { id: event.target.value });
                      if (activeProfileId === previous) setActiveProfileId(event.target.value);
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
                <Field label="Base URL">
                  <input
                    value={profile.baseUrl}
                    onChange={(event) => updateProfile(index, { baseUrl: event.target.value })}
                    className="field-input"
                    spellCheck={false}
                    placeholder="https://api.example.com/v1"
                  />
                </Field>
                <Field label="Model ID">
                  <input
                    value={profile.modelId}
                    onChange={(event) => updateProfile(index, { modelId: event.target.value })}
                    className="field-input"
                    spellCheck={false}
                    placeholder="model-id"
                    list={`provider-models-${index}`}
                  />
                  {profile.models?.length ? (
                    <datalist id={`provider-models-${index}`}>
                      {profile.models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.name}
                        </option>
                      ))}
                    </datalist>
                  ) : null}
                </Field>
                <label className="col-span-2 flex items-center gap-2 text-app-12 text-muted">
                  <input
                    type="checkbox"
                    checked={profile.thinking === true}
                    onChange={(event) => updateProfile(index, { thinking: event.target.checked })}
                    className="h-3.5 w-3.5 accent-fg"
                  />
                  <span>Enable Thinking</span>
                </label>
                <Field label="API Key" className="col-span-2">
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
                {profile.oauthSupported ? (
                  <div className="col-span-2 flex flex-wrap items-center justify-between gap-3">
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
            </section>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-fg px-3 text-app-12 font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saving ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Save Profiles
        </button>
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
