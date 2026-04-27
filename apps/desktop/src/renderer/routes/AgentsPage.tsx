import { useEffect, useRef, useState, useCallback } from "react";
import { Input, Textarea } from "@carrent/ui";
import {
  Bot,
  Plus,
  Trash2,
  ChevronUp,
  Loader2,
  BookOpenText,
  SlidersHorizontal,
  X,
  Upload,
} from "lucide-react";
import { useAgents } from "../context/AgentContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useRuntimes } from "../hooks/useRuntimes";
import { RuntimeIcon } from "../components/RuntimeIcon";
import type { AgentRecord } from "../mock/uiShellData";
import { runtimeNameMap } from "../../shared/runtimes";

/* -------------------------------------------------------------------------- */
/*  Runtime Picker                                                            */
/* -------------------------------------------------------------------------- */

function RuntimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const { runtimes } = useRuntimes();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  const selectedRuntime = runtimes.find((r) => r.id === value);
  const displayName = selectedRuntime?.name ?? runtimeNameMap[value as keyof typeof runtimeNameMap] ?? value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border border-white/[0.06] bg-[#1a1a1a] px-3 py-2 text-left transition-colors hover:border-white/[0.10]"
      >
        {displayName ? (
          <>
            <RuntimeIcon name={displayName} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-[#d0d0d0]">
              {displayName}
            </span>
            <ChevronUp
              className={`h-3.5 w-3.5 shrink-0 text-[#555] transition-transform ${open ? "" : "rotate-180"}`}
            />
          </>
        ) : (
          <span className="text-[13px] text-[#555]">Choose a runtime</span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-md border border-white/[0.06] bg-[#1a1a1a] shadow-lg shadow-black/30">
          {runtimes.map((runtime) => {
            const isSelected = runtime.id === value;
            const isOnline = runtime.availability === "detected";
            return (
              <button
                key={runtime.id}
                type="button"
                onClick={() => {
                  onChange(runtime.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${
                  isSelected ? "bg-white/[0.05]" : "hover:bg-white/[0.03]"
                }`}
              >
                <RuntimeIcon name={runtime.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-[#d0d0d0]">
                  {runtime.name}
                </span>
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isOnline ? "bg-emerald-400" : "bg-[#333]"
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab definitions                                                           */
/* -------------------------------------------------------------------------- */

const tabs = [
  { id: "instruction" as const, label: "Instruction", icon: BookOpenText },
  { id: "settings" as const, label: "Settings", icon: SlidersHorizontal },
];

/* -------------------------------------------------------------------------- */
/*  Agents Page                                                               */
/* -------------------------------------------------------------------------- */

export function AgentsPage() {
  const {
    agents,
    selectedAgentId,
    selectedAgent,
    setSelectedAgentId,
    createAgent,
    updateAgent,
    deleteAgent,
  } = useAgents();
  const { setActiveThreadId } = useWorkspace();

  useEffect(() => {
    setActiveThreadId(null);
  }, [setActiveThreadId]);

  const [draft, setDraft] = useState<AgentRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [tab, setTab] = useState<"instruction" | "settings">("instruction");

  /* Create agent modal */
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newRuntime, setNewRuntime] = useState<AgentRecord["runtime"]>("codex");
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedAgent) {
      setDraft({ ...selectedAgent });
      setTab("instruction");
    } else {
      setDraft(null);
    }
  }, [selectedAgent]);

  const handleCreate = () => {
    setNewName("");
    setNewDescription("");
    setNewRuntime("codex");
    setShowCreateModal(true);
  };

  const handleConfirmCreate = () => {
    const trimmedName = newName.trim();
    if (!trimmedName) return;
    const agent = createAgent({
      name: trimmedName,
      description: newDescription.trim(),
      runtime: newRuntime,
    });
    setShowCreateModal(false);
    setSelectedAgentId(agent.id);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
  };

  useEffect(() => {
    if (!showCreateModal) return;
    function handleClick(e: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setShowCreateModal(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCreateModal]);

  const handleDelete = () => {
    if (!selectedAgentId) return;
    deleteAgent(selectedAgentId);
  };

  const handleSave = () => {
    if (!draft) return;
    setIsSaving(true);
    updateAgent(draft);
    setTimeout(() => setIsSaving(false), 600);
  };

  const handleCancel = () => {
    if (selectedAgent) setDraft({ ...selectedAgent });
  };

  const handleAvatarChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        setDraft((prev) => (prev ? { ...prev, avatar: reader.result as string } : prev));
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  const hasChanges =
    draft && selectedAgent
      ? draft.name !== selectedAgent.name ||
        draft.responsibility !== selectedAgent.responsibility ||
        draft.runtime !== selectedAgent.runtime ||
        draft.description !== selectedAgent.description ||
        draft.avatar !== selectedAgent.avatar
      : false;

  /* Keyboard shortcut: Cmd+S / Ctrl+S */
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;
  const isSavingRef = useRef(isSaving);
  isSavingRef.current = isSaving;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasChangesRef.current && !isSavingRef.current) saveRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-full w-full bg-[#111]">
      {/* ---- Sidebar ---- */}
      <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-white/[0.04] bg-[#141414]">
        <div
          className="drag-region shrink-0"
          style={{ height: "env(titlebar-area-height, 38px)" }}
        />
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-[13px] font-medium text-[#666]">Agents</span>
          <button
            onClick={handleCreate}
            className="flex h-6 w-6 items-center justify-center rounded text-[#555] transition-colors hover:bg-white/[0.06] hover:text-[#ccc]"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-2 pb-3">
          {agents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.03]">
                <Bot className="h-5 w-5 text-[#444]" />
              </div>
              <p className="text-[14px] text-[#555]">No agents</p>
              <button
                onClick={handleCreate}
                className="text-[13px] text-[#666] transition-colors hover:text-[#aaa]"
              >
                Create your first agent
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {agents.map((agent) => {
                const isActive = agent.id === selectedAgentId;
                return (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? "bg-[#222] text-[#e8e8e8]"
                        : "text-[#888] hover:bg-white/[0.03] hover:text-[#ccc]"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded ${
                        isActive ? "bg-white/[0.06]" : "bg-white/[0.03]"
                      }`}
                    >
                      {agent.avatar ? (
                        <img src={agent.avatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Bot className="h-4 w-4 opacity-50" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] leading-tight">
                        {agent.name || "Untitled"}
                      </div>
                      <div className="truncate text-[12px] text-[#555] leading-tight">
                        {runtimeNameMap[agent.runtime] ?? agent.runtime}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* ---- Main ---- */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#111]">
        <div
          className="drag-region shrink-0"
          style={{ height: "env(titlebar-area-height, 38px)" }}
        />

        {!draft ? (
          /* Empty state */
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/[0.03]">
              <Bot className="h-5 w-5 text-[#444]" />
            </div>
            <div className="text-center">
              <p className="text-[14px] text-[#555]">Select an agent</p>
              <p className="mt-0.5 text-[13px] text-[#444]">
                Choose from the sidebar or create a new one
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* ---- Header ---- */}
            <div className="flex w-full shrink-0 items-center justify-between border-b border-white/[0.04] px-8 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md bg-white/[0.04]">
                  {draft.avatar ? (
                    <img src={draft.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Bot className="h-4 w-4 text-[#555]" />
                  )}
                </div>
                <div>
                  <h1 className="text-[15px] font-medium text-[#e0e0e0]">
                    {draft.name || "Untitled"}
                  </h1>
                  <p className="text-[11px] text-[#555]">{draft.runtime}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {hasChanges && (
                  <span className="text-[11px] text-[#888]">Unsaved changes</span>
                )}
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-[#888] transition-colors hover:bg-white/[0.04] hover:text-[#c44]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>

            {/* ---- Content ---- */}
            <div className="flex w-full flex-1 flex-col overflow-hidden">
              {/* Tab bar */}
              <div className="flex shrink-0 gap-6 border-b border-white/[0.04] px-8">
                {tabs.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`relative flex items-center gap-2 py-3 text-[13px] transition-colors ${
                        active
                          ? "text-[#e0e0e0]"
                          : "text-[#555] hover:text-[#888]"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{t.label}</span>
                      {active && (
                        <span className="absolute bottom-0 left-0 right-0 h-[1.5px] bg-[#e0e0e0]" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Scrollable area */}
              <div className="flex-1 overflow-auto">
                <div className="mx-auto w-full max-w-2xl px-8 py-8">
                  {tab === "instruction" ? (
                    /* Instruction */
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[12px] text-[#666]">System prompt</label>
                        <span className="text-[11px] tabular-nums text-[#444]">
                          {draft.responsibility.length} chars
                        </span>
                      </div>
                      <Textarea
                        value={draft.responsibility}
                        onChange={(e) =>
                          setDraft((prev) =>
                            prev ? { ...prev, responsibility: e.target.value } : prev,
                          )
                        }
                        className="min-h-[360px] resize-y border-white/[0.06] bg-[#161616] text-[13px] leading-relaxed text-[#ccc] placeholder:text-[#444] focus:border-white/[0.12] focus:ring-0"
                        placeholder="Define how this agent should behave..."
                        spellCheck={false}
                      />
                    </div>
                  ) : (
                    /* Settings */
                    <div className="flex flex-col gap-8">
                      {/* Avatar + Name */}
                      <div className="flex items-start gap-5">
                        <div className="flex shrink-0 flex-col items-center gap-2">
                          <label className="relative flex h-16 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-md bg-white/[0.03] transition-colors hover:bg-white/[0.05]">
                            <input
                              type="file"
                              accept="image/*"
                              className="sr-only"
                              onChange={handleAvatarChange}
                            />
                            {draft.avatar ? (
                              <img
                                src={draft.avatar}
                                alt="Avatar"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Bot className="h-6 w-6 text-[#444]" />
                            )}
                            <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity hover:opacity-100">
                              <Upload className="h-4 w-4 text-white" />
                            </span>
                          </label>
                          {draft.avatar && (
                            <button
                              onClick={() =>
                                setDraft((prev) => (prev ? { ...prev, avatar: "" } : prev))
                              }
                              className="text-[11px] text-[#555] transition-colors hover:text-[#888]"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-5">
                          <div>
                            <label className="mb-1.5 block text-[12px] text-[#666]">Name</label>
                            <Input
                              value={draft.name}
                              onChange={(e) =>
                                setDraft((prev) =>
                                  prev ? { ...prev, name: e.target.value } : prev,
                                )
                              }
                              className="border-white/[0.06] bg-[#161616] text-[13px] text-[#ccc] placeholder:text-[#444] focus:border-white/[0.12] focus:ring-0"
                              placeholder="e.g. Architect"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label className="mb-1.5 block text-[12px] text-[#666]">
                          Description
                        </label>
                        <Textarea
                          className="min-h-[80px] resize-y border-white/[0.06] bg-[#161616] text-[13px] text-[#ccc] placeholder:text-[#444] focus:border-white/[0.12] focus:ring-0"
                          value={draft.description ?? ""}
                          onChange={(e) =>
                            setDraft((prev) =>
                              prev ? { ...prev, description: e.target.value } : prev,
                            )
                          }
                          placeholder="Brief summary of what this agent does"
                        />
                      </div>

                      {/* Runtime */}
                      <div>
                        <label className="mb-1.5 block text-[12px] text-[#666]">Runtime</label>
                        <RuntimePicker
                          value={draft.runtime}
                          onChange={(runtime) =>
                            setDraft((prev) =>
                              prev ? { ...prev, runtime: runtime as AgentRecord["runtime"] } : prev,
                            )
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ---- Footer ---- */}
              <div className="flex w-full shrink-0 items-center justify-between border-t border-white/[0.04] px-8 py-3">
                <span className="text-[11px] text-[#444]">
                  <kbd className="rounded border border-white/[0.06] bg-white/[0.03] px-1 py-0.5 font-mono text-[10px] text-[#555]">
                    {navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}S
                  </kbd>
                  <span className="ml-1.5">to save</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCancel}
                    disabled={!hasChanges}
                    className="rounded-md px-3 py-1.5 text-[12px] text-[#888] transition-colors hover:bg-white/[0.04] hover:text-[#ccc] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#888]"
                  >
                    Discard
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    className="flex items-center gap-1.5 rounded-md bg-[#e0e0e0] px-3 py-1.5 text-[12px] font-medium text-[#111] transition-colors hover:bg-white disabled:bg-[#333] disabled:text-[#666] disabled:opacity-100"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Saving
                      </>
                    ) : (
                      "Save changes"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ---- Create Agent Modal ---- */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div
            ref={modalRef}
            className="w-full max-w-md rounded-lg border border-white/[0.06] bg-[#1a1a1a] shadow-xl"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
              <h2 className="text-[14px] font-medium text-[#e0e0e0]">New agent</h2>
              <button
                onClick={handleCloseModal}
                className="flex h-6 w-6 items-center justify-center rounded text-[#555] transition-colors hover:bg-white/[0.06] hover:text-[#ccc]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-4 px-5 py-4">
              <div>
                <label className="mb-1.5 block text-[12px] text-[#666]">
                  Name <span className="text-[#a44]">*</span>
                </label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="border-white/[0.06] bg-[#161616] text-[13px] text-[#ccc] placeholder:text-[#444] focus:border-white/[0.12] focus:ring-0"
                  placeholder="e.g. Architect"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleConfirmCreate();
                    }
                  }}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] text-[#666]">Description</label>
                <Textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="min-h-[72px] resize-y border-white/[0.06] bg-[#161616] text-[13px] text-[#ccc] placeholder:text-[#444] focus:border-white/[0.12] focus:ring-0"
                  placeholder="Brief summary of what this agent does"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] text-[#666]">
                  Runtime <span className="text-[#a44]">*</span>
                </label>
                <RuntimePicker
                  value={newRuntime}
                  onChange={(v) => setNewRuntime(v as AgentRecord["runtime"])}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-5 py-3.5">
              <button
                onClick={handleCloseModal}
                className="rounded-md px-3 py-1.5 text-[12px] text-[#888] transition-colors hover:bg-white/[0.04] hover:text-[#ccc]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCreate}
                disabled={!newName.trim()}
                className="rounded-md bg-[#e0e0e0] px-3 py-1.5 text-[12px] font-medium text-[#111] transition-colors hover:bg-white disabled:opacity-40"
              >
                Create agent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
