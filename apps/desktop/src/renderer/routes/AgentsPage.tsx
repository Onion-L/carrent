import { useEffect, useRef, useState } from "react";
import { Button, Input, Textarea } from "@carrent/ui";
import {
  Bot,
  Plus,
  Trash2,
  ChevronUp,
  Loader2,
  BookOpenText,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useAgents } from "../context/AgentContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useRuntimes } from "../hooks/useRuntimes";
import { RuntimeIcon } from "../components/RuntimeIcon";
import type { AgentRecord } from "../mock/uiShellData";

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl bg-[#1c1c1c] px-4 py-3 text-left ring-1 ring-white/[0.06] transition-all duration-300 hover:bg-[#222] hover:ring-white/[0.10]"
      >
        {selectedRuntime ? (
          <>
            <RuntimeIcon name={selectedRuntime.name} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#e0e0e0]">
              {selectedRuntime.name}
            </span>
            <ChevronUp
              className={`h-4 w-4 shrink-0 text-[#555] transition-transform duration-300 ${open ? "" : "rotate-180"}`}
            />
          </>
        ) : (
          <span className="text-[13px] text-[#555]">Choose a runtime</span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-xl border border-white/[0.06] bg-[#171717] shadow-2xl shadow-black/40">
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
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-200 ${
                  isSelected ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                }`}
              >
                <RuntimeIcon name={runtime.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#e0e0e0]">
                  {runtime.name}
                </span>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full transition-colors duration-500 ${
                    isOnline ? "bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,0.4)]" : "bg-[#333]"
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
      <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-white/[0.04] bg-[#141414]">
        <div
          className="drag-region shrink-0"
          style={{ height: "env(titlebar-area-height, 38px)" }}
        />
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#555]">
            Agents
          </span>
          <button
            onClick={handleCreate}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#666] transition-all duration-200 hover:bg-white/[0.06] hover:text-[#ddd] active:scale-95"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-3 pb-3">
          {agents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03]">
                <Bot className="h-5 w-5 text-[#444]" />
              </div>
              <p className="text-[13px] text-[#555]">No agents</p>
              <button
                onClick={handleCreate}
                className="mt-1 text-[12px] text-[#777] transition-colors duration-200 hover:text-[#bbb]"
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
                    className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ${
                      isActive
                        ? "bg-white/[0.06] text-[#e8e8e8] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                        : "text-[#888] hover:bg-white/[0.04] hover:text-[#ccc]"
                    }`}
                  >
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[14px] transition-colors duration-200 ${
                        isActive
                          ? "bg-white/[0.08]"
                          : "bg-white/[0.03] group-hover:bg-white/[0.05]"
                      }`}
                    >
                      {agent.avatar || <Bot className="h-3.5 w-3.5 opacity-60" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium leading-snug">
                        {agent.name || "Untitled"}
                      </div>
                      <div className="truncate text-[11px] text-[#555] leading-snug">
                        {agent.runtime}
                      </div>
                    </div>
                    {isActive && (
                      <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4a6cf7] shadow-[0_0_8px_rgba(74,108,247,0.5)]" />
                    )}
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
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.04]">
              <Bot className="h-7 w-7 text-[#444]" />
            </div>
            <div className="text-center">
              <p className="text-[15px] font-medium text-[#666]">Select an agent</p>
              <p className="mt-1 text-[13px] text-[#444]">
                Choose from the sidebar or create a new one
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* ---- Header ---- */}
            <div className="mx-auto flex w-full max-w-3xl shrink-0 items-center justify-between px-8 py-5">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-[20px] ring-1 ring-white/[0.05]">
                  {draft.avatar || <Bot className="h-5 w-5 text-[#666]" />}
                </div>
                <div>
                  <h1 className="text-[17px] font-semibold tracking-tight text-[#e4e4e4]">
                    {draft.name || "Untitled"}
                  </h1>
                  <p className="text-[12px] text-[#555]">{draft.runtime}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {hasChanges && (
                  <span className="flex items-center gap-1.5 text-[11px] text-[#b0852c]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b0852c]" />
                    Unsaved
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5 border-white/[0.06] bg-transparent text-[#a44] ring-1 ring-white/[0.06] transition-all duration-200 hover:bg-white/[0.04] hover:text-[#d44] active:scale-[0.97]"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>

            {/* ---- Tab bar ---- */}
            <div className="mx-auto flex w-full max-w-3xl shrink-0 gap-1 px-8">
              {tabs.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`group relative flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-medium transition-all duration-300 ${
                      active
                        ? "text-[#e8e8e8]"
                        : "text-[#555] hover:text-[#999]"
                    }`}
                  >
                    {active && (
                      <div
                        className="absolute inset-0 rounded-xl bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                        style={{
                          transition: "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
                        }}
                      />
                    )}
                    <Icon className="relative h-3.5 w-3.5" />
                    <span className="relative">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* ---- Content ---- */}
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-8 py-6">
              {tab === "instruction" ? (
                /* Instruction */
                <div className="flex flex-1 flex-col">
                  <div className="mb-3 flex items-center justify-between">
                    <label className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#555]">
                      System Prompt
                    </label>
                    <span className="font-mono text-[11px] tabular-nums text-[#444]">
                      {draft.responsibility.length}&thinsp;/&thinsp;no limit
                    </span>
                  </div>
                  <div className="relative flex-1 overflow-hidden rounded-2xl bg-[#151515] ring-1 ring-white/[0.05] transition-shadow duration-300 focus-within:ring-white/[0.10] focus-within:shadow-[0_0_0_4px_rgba(74,108,247,0.06)]">
                    {/* Line numbers gutter */}
                    <div className="absolute left-0 top-0 h-full w-[48px] select-none border-r border-white/[0.04] bg-[#181818] py-4 pl-5 pr-2 text-right font-mono text-[11px] leading-[1.75] text-[#333]">
                      {draft.responsibility.split("\n").map((_, i) => (
                        <div key={i}>{i + 1}</div>
                      ))}
                    </div>
                    <textarea
                      value={draft.responsibility}
                      onChange={(e) =>
                        setDraft((prev) =>
                          prev ? { ...prev, responsibility: e.target.value } : prev,
                        )
                      }
                      className="h-full w-full resize-none bg-transparent py-4 pl-[60px] pr-5 font-mono text-[13px] leading-[1.75] text-[#ccc] placeholder-[#333] outline-none"
                      placeholder={
                        "// Define how this agent should behave...\n//\n// Example:\n// You are a senior engineer focused on system\n// architecture and clean API design. Prefer\n// composition over inheritance."
                      }
                      spellCheck={false}
                    />
                  </div>
                </div>
              ) : (
                /* Settings */
                <div className="flex-1 overflow-auto">
                  <div className="flex max-w-xl flex-col gap-8">
                    {/* Avatar + Name row */}
                    <div className="flex items-start gap-6">
                      <div className="flex shrink-0 flex-col items-center gap-3">
                        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/[0.03] text-[28px] ring-1 ring-white/[0.05]">
                          {draft.avatar || <Bot className="h-8 w-8 text-[#444]" />}
                        </div>
                        <button
                          onClick={() =>
                            setDraft((prev) =>
                              prev ? { ...prev, avatar: "" } : prev,
                            )
                          }
                          className="text-[11px] text-[#555] transition-colors duration-200 hover:text-[#888]"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col gap-5">
                        <div>
                          <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.08em] text-[#555]">
                            Avatar
                          </label>
                          <Input
                            value={draft.avatar ?? ""}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev ? { ...prev, avatar: e.target.value } : prev,
                              )
                            }
                            className="bg-[#151515] ring-1 ring-white/[0.05] transition-shadow duration-300 focus:ring-white/[0.10]"
                            placeholder="A single character or short symbol"
                            maxLength={4}
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.08em] text-[#555]">
                            Name
                          </label>
                          <Input
                            value={draft.name}
                            onChange={(e) =>
                              setDraft((prev) =>
                                prev ? { ...prev, name: e.target.value } : prev,
                              )
                            }
                            className="bg-[#151515] ring-1 ring-white/[0.05] transition-shadow duration-300 focus:ring-white/[0.10]"
                            placeholder="e.g. Architect"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Description */}
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.08em] text-[#555]">
                        Description
                      </label>
                      <Textarea
                        className="min-h-[72px] bg-[#151515] ring-1 ring-white/[0.05] transition-shadow duration-300 focus:ring-white/[0.10]"
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
                      <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.08em] text-[#555]">
                        Runtime
                      </label>
                      <RuntimePicker
                        value={draft.runtime}
                        onChange={(runtime) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, runtime: runtime as AgentRecord["runtime"] }
                              : prev,
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ---- Footer ---- */}
            <div className="mx-auto flex w-full max-w-3xl shrink-0 items-center justify-between border-t border-white/[0.04] px-8 py-4">
              <span className="text-[11px] text-[#444]">
                <kbd className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-[#555] ring-1 ring-white/[0.04]">
                  {navigator.platform.includes("Mac") ? "⌘" : "Ctrl+"}S
                </kbd>
                <span className="ml-1.5">to save</span>
              </span>
              <div className="flex items-center gap-2.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={!hasChanges || isSaving}
                  className="text-[#888] transition-all duration-200 hover:text-[#ccc] disabled:opacity-30"
                >
                  Discard
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSave}
                  disabled={!hasChanges || isSaving}
                  className="gap-1.5 bg-white text-[13px] font-medium text-black transition-all duration-200 hover:bg-[#eee] active:scale-[0.97] disabled:bg-[#2a2a2a] disabled:text-[#555] disabled:opacity-100"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ---- Create Agent Modal ---- */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div
            ref={modalRef}
            className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-[#1a1a1a] shadow-2xl shadow-black/50"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
              <h2 className="text-[15px] font-semibold text-[#e4e4e4]">New Agent</h2>
              <button
                onClick={handleCloseModal}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#666] transition-all duration-200 hover:bg-white/[0.06] hover:text-[#ddd]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-5 px-6 py-5">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.08em] text-[#555]">
                  Name <span className="text-[#a44]">*</span>
                </label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="bg-[#151515] ring-1 ring-white/[0.05] transition-shadow duration-300 focus:ring-white/[0.10]"
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
                <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.08em] text-[#555]">
                  Description
                </label>
                <Textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="min-h-[72px] bg-[#151515] ring-1 ring-white/[0.05] transition-shadow duration-300 focus:ring-white/[0.10]"
                  placeholder="Brief summary of what this agent does"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.08em] text-[#555]">
                  Runtime <span className="text-[#a44]">*</span>
                </label>
                <RuntimePicker value={newRuntime} onChange={(v) => setNewRuntime(v as AgentRecord["runtime"])} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t border-white/[0.06] px-6 py-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseModal}
                className="text-[#888] transition-all duration-200 hover:text-[#ccc]"
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleConfirmCreate}
                disabled={!newName.trim()}
                className="bg-white text-[13px] font-medium text-black transition-all duration-200 hover:bg-[#eee] active:scale-[0.97] disabled:bg-[#2a2a2a] disabled:text-[#555] disabled:opacity-100"
              >
                Create Agent
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
