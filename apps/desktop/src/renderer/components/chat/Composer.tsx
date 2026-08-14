import {
  AlertTriangle,
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  CornerDownRight,
  FileText,
  Folder,
  GitBranch,
  Lock,
  ListChecks,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import type {
  AttachmentMetadata,
  KimiSessionStatus,
  RuntimeQuotaWindow,
} from "../../../shared/chat";
import { isTerminalSharedChatRunStatus } from "../../../shared/chat";
import type {
  AppThreadActionRecord,
  AppThreadRunStartInput,
} from "../../../shared/workspacePersistence";
import {
  FILE_ATTACHMENT_ICONS,
  fileAttachmentIconKind,
  formatAttachmentSize,
  hasUnavailablePendingAttachments,
  metadataOnly,
  pendingAttachmentFromFile,
  pendingAttachmentFromMetadata,
  pendingAttachmentFromUnavailableMetadata,
  pendingImageAttachments,
  validateAttachmentSelection,
  type PendingAttachment,
} from "../../lib/attachments";
import { isFilesystemFileDrag } from "../../lib/fileDrag";
import {
  dedupeLocalPathContexts,
  type LocalPathContextItem,
  type LocalPathContextKind,
} from "../../../shared/localPathContext";
import { deriveThreadTitle } from "../../../shared/threadTitle";
import { ImageAttachmentLightbox, type LightboxItem } from "./ImageAttachmentLightbox";
import { splitPatchIntoFileBlocks } from "./WorkspaceDiffViewer";

import { StreamingTextRevealer } from "./typewriter";
import { useThreadContent } from "../../context/ThreadContentContext";
import { useAppState } from "../../context/AppStateContext";
import { useChatRun } from "../../hooks/useChatRun";
import { useSessionStatus } from "../../hooks/useSessionStatus";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  getCompactAvailability,
  getCompactUnavailableMessage,
  parseLeadingCompactCommand,
  parseLeadingStatusCommand,
} from "../../lib/threadActions";
import { QuestionPanel, getPendingQuestionForThread } from "./QuestionPanel";
import { PlanDecisionPanel } from "./PlanDecisionPanel";
import { RunChecklist } from "./RunChecklist";
import {
  buildQuestionAnswerRecords,
  clearQuestionDraftState,
  getQuestionDraftsFromAnswers,
  getQuestionDraftState,
} from "../../lib/questionDrafts";
import {
  clearThreadDraft,
  enqueueChatMessage,
  getQueuedMessages,
  getThreadDraft,
  getThreadDraftSnapshotKey,
  removeQueuedChatMessage,
  setThreadDraft,
  shiftQueuedChatMessage,
  subscribeToThreadWork,
  unshiftQueuedChatMessage,
  updateQueuedChatMessage,
  useQueuedMessages,
  type QueuedChatMessage,
  type ThreadWorkDraftSnapshot,
} from "../../hooks/chatMessageQueue";
import type { Message } from "../../../shared/threadContent";
import type { GitWorkspaceDiffResult } from "../../../../electron/git/gitIpc";
import {
  type ChatReasoningEventPayload,
  type ChatShellEventPayload,
  type ChatSubagentTaskPayload,
} from "../../../shared/chat";
import type { SkillRecord } from "../../../shared/skills";
import type {
  ChatPermissionOptionKind,
  ChatPermissionRequest,
} from "../../../shared/chatPermissions";
import {
  DEFAULT_RUNTIME_MODE,
  getRuntimeModeLabel,
  type RuntimeMode,
} from "../../../shared/runtimeMode";
import {
  runtimeNameMap,
  type RuntimeId,
  type RuntimeModelRecord,
  type RuntimeRecord,
} from "../../../shared/runtimes";
import { RuntimeIcon } from "../RuntimeIcon";
import { useRuntimeModels } from "../../hooks/useRuntimeModels";
import { useRuntimes } from "../../hooks/useRuntimes";
import { useSkills } from "../../hooks/useSkills";
import { useMcpServer } from "../../hooks/useMcpServer";
import { getChatRuntimeOptions, isChatRuntimeAvailable } from "../../lib/runtimeSelection";
import { useToast } from "../toast/ToastContext";
import {
  ComposerEditor,
  type ComposerEditorHandle,
  type ComposerEditorTrigger,
} from "./ComposerEditor";
import { formatSkillLabel } from "./skillLabel";

function RuntimeModeIcon({ mode, className }: { mode: RuntimeMode; className?: string }) {
  switch (mode) {
    case "approval-required":
      return <Lock className={className} />;
    case "auto-accept-edits":
      return <Pencil className={className} />;
    case "full-access":
      return <AlertTriangle className={className} />;
  }
}

function ContextUsageIndicator({
  status,
  loadState,
  onRefresh,
}: {
  status: KimiSessionStatus | null;
  loadState: "loading" | "ready" | "error";
  onRefresh: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    if (!isPinned) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsPinned(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isPinned]);

  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const percentage = status?.percentage ?? 0;
  const offset = circumference * (1 - Math.min(percentage, 100) / 100);
  const showPopover = isHovered || isPinned;

  return (
    <div
      ref={rootRef}
      className="relative flex h-8 w-8 items-center justify-center"
      onMouseEnter={() => {
        setIsHovered(true);
        onRefresh();
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center"
        title="Kimi context usage"
        aria-label="Kimi context usage"
        aria-expanded={showPopover}
        onClick={() => {
          setIsPinned((pinned) => !pinned);
          if (!isHovered) onRefresh();
        }}
      >
        {loadState === "error" ? (
          <span className="text-app-11 font-medium text-muted">--</span>
        ) : (
          <svg className="h-5 w-5 -rotate-90" viewBox="0 0 20 20">
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-border-strong"
            />
            <circle
              cx="10"
              cy="10"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
              className={percentage > 90 ? "text-danger" : "text-fg"}
            />
          </svg>
        )}
      </button>
      {showPopover && (
        <div className="absolute bottom-full right-0 mb-2 w-52 rounded-lg border border-border-strong bg-surface px-3 py-2 shadow-xl">
          {loadState === "error" ? (
            <div className="text-app-12 text-muted">Context usage unavailable</div>
          ) : status ? (
            <>
              <div className="text-app-11 text-muted">Context usage</div>
              <div className="mt-0.5 text-app-12 font-medium text-fg">
                {status.used.toLocaleString()} / {status.total.toLocaleString()} (
                {status.percentage.toFixed(1)}%)
              </div>
              {status.model ? (
                <div className="mt-1 truncate text-app-11 text-subtle">{status.model}</div>
              ) : null}
            </>
          ) : (
            <div className="text-app-12 text-muted">No context data yet</div>
          )}
        </div>
      )}
    </div>
  );
}

function formatPercentage(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

function formatCompactTokens(value: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatQuotaWindow(window: RuntimeQuotaWindow) {
  const details: string[] = [];
  if (window.usedPercentage !== undefined) {
    const used = Math.min(100, Math.max(0, window.usedPercentage));
    details.push(`Used ${formatPercentage(used)}%`, `Remaining ${formatPercentage(100 - used)}%`);
  }
  if (window.reset) {
    details.push(`Resets ${window.reset}`);
  }
  return details.join(" · ");
}

function SessionStatusPanel({
  status,
  loading,
  onClose,
}: {
  status: KimiSessionStatus;
  loading: boolean;
  onClose: () => void;
}) {
  const remaining = Math.min(100, Math.max(0, 100 - status.percentage));
  const planUsage = status.planUsage;

  return (
    <section
      aria-labelledby="session-status-title"
      aria-busy={loading}
      className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-80 overflow-y-auto rounded-xl border border-border-strong bg-surface px-4 py-3 shadow-[0_18px_60px_rgb(0_0_0/0.28)]"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="session-status-title" className="text-app-13 font-semibold text-fg">
          Status
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          title="Close"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="mt-3 grid gap-3 text-app-12">
        <div>
          <dt className="text-muted">Session</dt>
          <dd className="mt-1 select-text break-all font-mono text-fg">{status.sessionId}</dd>
        </div>
        <div>
          <dt className="text-muted">Context</dt>
          <dd className="mt-1 text-fg">
            Remaining {formatPercentage(remaining)}% ({status.used.toLocaleString("en-US")} used /{" "}
            {formatCompactTokens(status.total)} total)
          </dd>
        </div>
        {planUsage?.weekly || planUsage?.fiveHour ? (
          <div>
            <dt className="text-muted">Plan usage</dt>
            <dd className="mt-1 grid gap-1.5 text-fg">
              {planUsage.weekly ? (
                <div>
                  <span className="font-medium">Weekly</span>
                  <span className="ml-2 text-muted">{formatQuotaWindow(planUsage.weekly)}</span>
                </div>
              ) : null}
              {planUsage.fiveHour ? (
                <div>
                  <span className="font-medium">5h</span>
                  <span className="ml-2 text-muted">{formatQuotaWindow(planUsage.fiveHour)}</span>
                </div>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export type ComposerSubmitRequest = {
  messageId: string;
  content: string;
  attachments?: AttachmentMetadata[];
  localPathContexts?: LocalPathContextItem[];
  requestId: number;
};

export type ComposerDraftRequest = {
  content: string;
  requestId: number;
};

export type AssociationDraftPromotionInput = AppThreadRunStartInput & {
  assistantMessageId: string;
  // Visible composer text. The Main Process derives the promoted Thread's
  // fallback title from it; the Renderer never supplies a finished title.
  titleSource: string;
  draft: ThreadWorkDraftSnapshot;
};

export type ComposerAcceptedRunInput = AppThreadRunStartInput & { assistantMessageId: string };

// Imperative handle a parent surface (the whole conversation area) uses to push
// resolved Local Path Context items into the Composer, which owns the card
// state. The parent resolves dropped DOM File objects through the privileged
// preload capability and shows the rejection toast; this adder only merges the
// accepted items into the composition.
export type LocalPathContextAddRef = {
  current: ((items: LocalPathContextItem[]) => void) | null;
};

export function ConversationDropSurface({
  children,
  localPathContextAddRef,
}: {
  children: ReactNode;
  localPathContextAddRef: LocalPathContextAddRef;
}) {
  const { showToast } = useToast();
  const dragDepthRef = useRef(0);
  const [dropActive, setDropActive] = useState(false);

  const resetDropState = useCallback(() => {
    dragDepthRef.current = 0;
    setDropActive(false);
  }, []);

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFilesystemFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDropActive(true);
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFilesystemFileDrag(event.dataTransfer)) return;
    if (dragDepthRef.current === 0) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDropActive(false);
  };

  // Safety net: a drag that ends anywhere in the window (or loses window focus
  // mid-drag) without a matching dragleave must not leave the overlay stuck.
  useEffect(() => {
    const reset = () => resetDropState();
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
      window.removeEventListener("blur", reset);
    };
  }, [resetDropState]);

  const handleDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    if (!isFilesystemFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    resetDropState();

    try {
      const result = await window.carrent.localPaths.resolveFiles(
        Array.from(event.dataTransfer.files),
      );
      localPathContextAddRef.current?.(result.items);
      if (result.rejections.length > 0) {
        showToast(
          result.rejections.length === 1
            ? "One dropped item is not an available local file or folder."
            : `${result.rejections.length} dropped items are not available local files or folders.`,
          "error",
        );
      }
    } catch {
      showToast("The dropped local file or folder could not be resolved.", "error");
    }
  };

  return (
    <div
      data-local-path-drop-surface
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => {
        if (isFilesystemFileDrag(event.dataTransfer)) event.preventDefault();
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      {children}
      {dropActive ? (
        <div
          data-local-path-drop-overlay
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-fg/35 bg-surface-raised/90 text-fg"
          role="status"
        >
          <div className="flex items-center gap-2 text-app-13 font-medium">
            <Folder className="h-4 w-4" />
            <span>File or folder context</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function mergeComposerDraftContent(current: string, incoming: string): string {
  if (!current.trim()) {
    return incoming;
  }

  return `${current.trimEnd()}\n\n${incoming}`;
}

export function getMessageTranscriptContent(message: Message) {
  if (
    message.type === "changed_files" ||
    !message.parts?.some((part) => part.type === "plan_review")
  ) {
    return message.content ?? "";
  }

  return message.parts
    .flatMap((part) => (part.type === "text" || part.type === "plan_review" ? [part.content] : []))
    .filter((content) => content.trim().length > 0)
    .join("\n\n");
}

export function collectRunLocalPathContexts(
  messages: Message[],
  current: LocalPathContextItem[],
  replacedMessageId?: string,
): LocalPathContextItem[] {
  const replacedIndex = replacedMessageId
    ? messages.findIndex((message) => message.id === replacedMessageId)
    : -1;
  const retainedMessages = replacedIndex >= 0 ? messages.slice(0, replacedIndex) : messages;
  return dedupeLocalPathContexts([
    ...retainedMessages.flatMap((message) =>
      message.role === "user" ? (message.localPathContexts ?? []) : [],
    ),
    ...current,
  ]);
}

export function getMissingRunCompletionText(receivedText: string, completedText: string) {
  return completedText.startsWith(receivedText) ? completedText.slice(receivedText.length) : "";
}

type ComposerProps =
  | {
      mode: "thread";
      placement?: "default" | "centered";
      workspaceId: string;
      projectId: string;
      threadId: string;
      messages: Message[];
      runtimeId: RuntimeId;
      runtimeModelId?: string;
      runtimeMode: RuntimeMode;
      planMode: boolean;
      submitRequest?: ComposerSubmitRequest;
      draftRequest?: ComposerDraftRequest;
      localPathContextAddRef?: LocalPathContextAddRef;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModelIdChange?: (modelId: string | undefined) => void;
      onRuntimeModeChange?: (mode: RuntimeMode) => void;
      onPlanModeChange?: (enabled: boolean) => void;
      onRunPrepared?: (input: ComposerAcceptedRunInput) => Promise<boolean>;
      onRunRejected?: (input: ComposerAcceptedRunInput) => Promise<void>;
    }
  | {
      mode: "association-draft";
      placement?: "default" | "centered";
      workspaceId: string;
      projectId: string;
      projectName: string;
      projectPath: string;
      threadId: string;
      initialDraft: ThreadWorkDraftSnapshot;
      messages: Message[];
      runtimeId: RuntimeId;
      runtimeModelId?: string;
      runtimeMode: RuntimeMode;
      planMode: boolean;
      submitRequest?: ComposerSubmitRequest;
      draftRequest?: ComposerDraftRequest;
      localPathContextAddRef?: LocalPathContextAddRef;
      onDraftChange: (draft: ThreadWorkDraftSnapshot | null) => void;
      onPromote: (input: AssociationDraftPromotionInput) => Promise<boolean>;
      onPromotionRejected: (draft: ThreadWorkDraftSnapshot) => Promise<void>;
      onPromoted: (threadId: string) => void;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModelIdChange?: (modelId: string | undefined) => void;
      onRuntimeModeChange?: (mode: RuntimeMode) => void;
      onPlanModeChange?: (enabled: boolean) => void;
    };

type AttachmentStoreBridge = {
  store: (input: {
    name: string;
    mimeType: string;
    data: Uint8Array;
  }) => Promise<AttachmentMetadata>;
};

type GitBranchInfo = {
  current: string | null;
  branches: string[];
  branchWorktrees: GitBranchWorktree[];
};

type GitBranchWorktree = {
  branch: string;
  path: string;
};

type GitBridge = {
  branches: (projectPath: string) => Promise<unknown>;
  checkout: (projectPath: string, branch: string) => Promise<unknown>;
  createBranch?: (projectPath: string, branch: string) => Promise<unknown>;
  workspaceSnapshot: (projectPath: string) => Promise<unknown>;
  workspaceDiff: (projectPath: string, baseRevision?: string) => Promise<unknown>;
};

const CREATE_BRANCH_DEFAULT_NAME = "carrent/";

// Stop replaces Send in place; keep it disabled briefly so the same rapid
// click sequence that started the run cannot immediately stop it.
const STOP_GUARD_MS = 500;
type StopGuardEntry = {
  guardedUntil: number;
  expiryTimeoutId: number | null;
};
const stopGuardByThread = new Map<string, StopGuardEntry>();

function getStopGuardRemainingMs(threadId: string) {
  return Math.max(0, (stopGuardByThread.get(threadId)?.guardedUntil ?? 0) - Date.now());
}

function scheduleStopGuardExpiry(threadId: string, entry: StopGuardEntry, onExpire?: VoidFunction) {
  if (stopGuardByThread.get(threadId) !== entry) return;
  if (entry.expiryTimeoutId !== null) window.clearTimeout(entry.expiryTimeoutId);
  entry.expiryTimeoutId = window.setTimeout(
    () => {
      if (stopGuardByThread.get(threadId) !== entry) return;
      stopGuardByThread.delete(threadId);
      onExpire?.();
    },
    Math.max(0, entry.guardedUntil - Date.now()),
  );
}

function beginStopGuard(threadId: string) {
  const existing = stopGuardByThread.get(threadId);
  if (existing && existing.expiryTimeoutId !== null) {
    window.clearTimeout(existing.expiryTimeoutId);
  }
  const entry: StopGuardEntry = {
    guardedUntil: Date.now() + STOP_GUARD_MS,
    expiryTimeoutId: null,
  };
  stopGuardByThread.set(threadId, entry);
  scheduleStopGuardExpiry(threadId, entry);
}

function getAttachmentStoreBridge(attachments: unknown): AttachmentStoreBridge {
  if (
    typeof attachments !== "object" ||
    attachments === null ||
    typeof (attachments as { store?: unknown }).store !== "function"
  ) {
    throw new Error("Attachments are unavailable. Restart Carrent and try again.");
  }

  return attachments as AttachmentStoreBridge;
}

export async function storeAttachmentFile(
  file: File,
  attachments: unknown,
): Promise<AttachmentMetadata> {
  const attachmentStore = getAttachmentStoreBridge(attachments);
  const data = new Uint8Array(await file.arrayBuffer());
  return attachmentStore.store({
    name: file.name,
    mimeType: file.type,
    data,
  });
}

export function canSubmitComposerContent(input: {
  content: string;
  attachedSkillCount: number;
  attachmentCount: number;
  localPathContextCount?: number;
  isPreparingAttachments: boolean;
  isExternalSubmit?: boolean;
  hasUnavailableAttachments?: boolean;
}): boolean {
  if (
    (input.isPreparingAttachments || input.hasUnavailableAttachments) &&
    !input.isExternalSubmit
  ) {
    return false;
  }
  return (
    input.content.trim().length > 0 ||
    input.attachedSkillCount > 0 ||
    input.attachmentCount > 0 ||
    (input.localPathContextCount ?? 0) > 0
  );
}

// Resolves persisted draft Skill names against the current Skill Catalog.
// Missing Skills are silently omitted so the text draft still loads.
export function resolveDraftSkillRecords(
  skills: SkillRecord[],
  attachedSkillNames: string[],
): SkillRecord[] {
  return attachedSkillNames.flatMap((name) => {
    const skill = skills.find((item) => item.name === name);
    return skill ? [skill] : [];
  });
}

// Builds the persistable draft for a Thread, or null when the Composer holds
// nothing worth keeping. Only metadata is persisted for attachments — never
// File instances or preview URLs. Local Path Context is plain path data and is
// persisted verbatim alongside attachments.
export function buildThreadDraftSnapshot(input: {
  content: string;
  attachedSkills: SkillRecord[];
  pendingAttachments: PendingAttachment[];
  localPathContexts?: LocalPathContextItem[];
  composerState?: string;
  metadataFallback?: Partial<Pick<ThreadWorkDraftSnapshot, "attachedSkillNames" | "attachments">>;
}): ThreadWorkDraftSnapshot | null {
  const attachments =
    input.metadataFallback?.attachments ??
    metadataOnly(
      input.pendingAttachments.flatMap((pending) => (pending.metadata ? [pending.metadata] : [])),
    );
  const attachedSkillNames =
    input.metadataFallback?.attachedSkillNames ?? input.attachedSkills.map((skill) => skill.name);
  const localPathContexts = input.localPathContexts ?? [];
  if (
    !input.content.trim() &&
    attachedSkillNames.length === 0 &&
    attachments.length === 0 &&
    localPathContexts.length === 0
  ) {
    return null;
  }
  return {
    content: input.content,
    attachedSkillNames,
    attachments,
    ...(localPathContexts.length > 0 ? { localPathContexts } : {}),
    ...(input.composerState ? { composerState: input.composerState } : {}),
  };
}

// Compares two drafts by their semantic content only (text, skills, attachments,
// Local Path Context), ignoring `composerState`. The serialized editor state
// changes on every keystroke (Lexical node keys, selection offsets), so
// including it in a readback equality check would make a locally-typed draft
// always differ from the just-persisted copy, echo-looping readback into the
// editor until the caret is lost.
function draftsContentEqual(
  a: ThreadWorkDraftSnapshot | null,
  b: ThreadWorkDraftSnapshot | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.content === b.content &&
    JSON.stringify(a.attachedSkillNames) === JSON.stringify(b.attachedSkillNames) &&
    JSON.stringify(a.attachments) === JSON.stringify(b.attachments) &&
    JSON.stringify(a.localPathContexts ?? []) === JSON.stringify(b.localPathContexts ?? [])
  );
}

async function restoreDraftAttachments(metadata: AttachmentMetadata[]) {
  const attachments: PendingAttachment[] = [];
  const unavailableNames: string[] = [];
  for (const item of metadata) {
    try {
      const data = await window.carrent.attachments.read(item);
      attachments.push(pendingAttachmentFromMetadata(item, data));
    } catch {
      unavailableNames.push(item.name);
      attachments.push(pendingAttachmentFromUnavailableMetadata(item));
    }
  }
  return { attachments, unavailableNames };
}

export function getGitBridge(carrent: unknown): GitBridge {
  const git =
    typeof carrent === "object" && carrent !== null ? (carrent as { git?: unknown }).git : null;

  if (
    typeof git !== "object" ||
    git === null ||
    typeof (git as { branches?: unknown }).branches !== "function" ||
    typeof (git as { checkout?: unknown }).checkout !== "function" ||
    typeof (git as { workspaceSnapshot?: unknown }).workspaceSnapshot !== "function" ||
    typeof (git as { workspaceDiff?: unknown }).workspaceDiff !== "function"
  ) {
    throw new Error("Git controls are unavailable. Restart Carrent and try again.");
  }

  return git as GitBridge;
}

export function normalizeGitBranchInfo(info: unknown): GitBranchInfo {
  const branchWorktrees = (info as { branchWorktrees?: unknown } | null)?.branchWorktrees;

  if (
    typeof info !== "object" ||
    info === null ||
    !Array.isArray((info as { branches?: unknown }).branches) ||
    !(info as { branches: unknown[] }).branches.every((branch) => typeof branch === "string") ||
    typeof (info as { current?: unknown }).current !== "string" ||
    (branchWorktrees !== undefined &&
      (!Array.isArray(branchWorktrees) ||
        !branchWorktrees.every(
          (worktree) =>
            typeof worktree === "object" &&
            worktree !== null &&
            typeof (worktree as { branch?: unknown }).branch === "string" &&
            typeof (worktree as { path?: unknown }).path === "string",
        )))
  ) {
    throw new Error("Git branch information is unavailable. Restart Carrent and try again.");
  }

  return {
    current: (info as { current: string }).current,
    branches: (info as { branches: string[] }).branches,
    branchWorktrees: (branchWorktrees ?? []) as GitBranchWorktree[],
  };
}

export function createWorkspaceDiffCapture(options: {
  mode: "thread";
  projectPath: string;
  threadId: string;
  captureBaseline: (projectPath: string) => Promise<string | null>;
  workspaceDiff: (projectPath: string, baseRevision?: string) => Promise<GitWorkspaceDiffResult>;
  appendWorkspaceDiffMessage: (
    threadId: string,
    result: Extract<GitWorkspaceDiffResult, { state: "ready" }>,
  ) => void;
  getRunWritePaths: () => readonly string[];
  showToast: (message: string, type: "error") => void;
}): () => Promise<void> {
  let capturePromise: Promise<void> | null = null;
  // Snapshots the worktree at send time so the diff captured after the run
  // only contains what changed during this run, not every pre-existing
  // uncommitted change. Baseline failures fall back to a HEAD diff.
  const baselinePromise = options.captureBaseline(options.projectPath).catch(() => null);

  return () => {
    if (capturePromise) {
      return capturePromise;
    }

    capturePromise = (async () => {
      try {
        const baseRevision = (await baselinePromise) ?? undefined;
        const result = await options.workspaceDiff(options.projectPath, baseRevision);
        if (result.state === "ready" && result.files.length > 0) {
          const projectRoot = result.projectRelativeRoot === "." ? "" : result.projectRelativeRoot;
          const repoWritePaths = new Set(
            options
              .getRunWritePaths()
              .map((writePath) => (projectRoot ? `${projectRoot}/${writePath}` : writePath)),
          );
          const files = result.files.filter((file) => repoWritePaths.has(file.path));
          if (files.length > 0) {
            const filePaths = new Set(files.map((file) => file.path));
            const patch = splitPatchIntoFileBlocks(result.patch)
              .filter((block) => filePaths.has(block.path))
              .map((block) => block.lines.join("\n"))
              .join("\n");
            options.appendWorkspaceDiffMessage(options.threadId, { ...result, files, patch });
          }
        }
      } catch {
        console.error("[workspace-diff] capture failed");
        options.showToast("Run finished, but workspace diff could not be captured.", "error");
      }
    })();
    return capturePromise;
  };
}

export function getGitToastMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const withoutIpcPrefix = message
    .replace(/^Error invoking remote method 'git:[^']+': Error:\s*/u, "")
    .trim();

  if (
    withoutIpcPrefix.includes(
      "Your local changes to the following files would be overwritten by checkout",
    ) ||
    withoutIpcPrefix.includes("Please commit your changes or stash them before you switch branches")
  ) {
    return "Cannot switch branches because you have local changes. Commit or stash them first.";
  }

  return withoutIpcPrefix.replace(/^Command failed: git checkout (?:-b )?[^\n]*\s*/u, "").trim();
}

type ComposerKeyDownEvent = {
  key: string;
  shiftKey: boolean;
  keyCode?: number;
  nativeEvent: {
    isComposing?: boolean;
  };
};

type ViewportSize = {
  width: number;
  height: number;
};

type RectLike = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;

type CascadingPanelSide = "right" | "left" | "center";

export type SkillSlashTrigger = {
  start: number;
  end: number;
  query: string;
};

export type CascadingPanelPosition = {
  left: number;
  top: number;
  width: number;
  side: CascadingPanelSide;
};

const CASCADING_PANEL_GAP = 8;
const CASCADING_PANEL_PADDING = 8;
const CASCADING_PANEL_MIN_WIDTH = 180;
const CASCADING_PANEL_DEFAULT_WIDTH = 288;

export function shouldSubmitComposerOnKeyDown(event: ComposerKeyDownEvent) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  );
}

export function shouldRemoveLastSkillOnBackspace({
  key,
  isComposing,
  selectionStart,
  selectionEnd,
  attachedSkillCount,
}: {
  key: string;
  isComposing: boolean;
  selectionStart: number;
  selectionEnd: number;
  attachedSkillCount: number;
}) {
  return (
    key === "Backspace" &&
    !isComposing &&
    selectionStart === 0 &&
    selectionEnd === 0 &&
    attachedSkillCount > 0
  );
}

export function getCascadingPanelPosition(
  anchorRect: RectLike,
  viewport: ViewportSize,
  panelSize: { width: number; height: number },
  gap = CASCADING_PANEL_GAP,
  padding = CASCADING_PANEL_PADDING,
): CascadingPanelPosition {
  const maxViewportWidth = Math.max(0, viewport.width - padding * 2);
  const desiredWidth = Math.min(
    Math.max(panelSize.width || CASCADING_PANEL_DEFAULT_WIDTH, CASCADING_PANEL_MIN_WIDTH),
    maxViewportWidth,
  );
  const rightSpace = viewport.width - padding - (anchorRect.right + gap);
  const leftSpace = anchorRect.left - gap - padding;
  const maxViewportHeight = Math.max(0, viewport.height - padding * 2);
  const desiredHeight = Math.min(panelSize.height || 0, maxViewportHeight || panelSize.height || 0);

  const useCenterFallback = Math.max(rightSpace, leftSpace) < CASCADING_PANEL_MIN_WIDTH;

  let side: CascadingPanelSide;
  let width: number;
  let left: number;

  if (!useCenterFallback && (rightSpace >= desiredWidth || rightSpace >= leftSpace)) {
    side = "right";
    width = Math.min(desiredWidth, Math.max(0, rightSpace));
    left = anchorRect.right + gap;
  } else if (!useCenterFallback) {
    side = "left";
    width = Math.min(desiredWidth, Math.max(0, leftSpace));
    left = anchorRect.left - gap - width;
  } else {
    side = "center";
    width = desiredWidth;
    left = (viewport.width - width) / 2;
  }

  const safeLeft = Math.min(
    Math.max(left, padding),
    Math.max(padding, viewport.width - padding - width),
  );
  const safeTop = Math.min(
    Math.max(anchorRect.top, padding),
    Math.max(padding, viewport.height - padding - desiredHeight),
  );

  return {
    left: safeLeft,
    top: safeTop,
    width,
    side,
  };
}

export function getDisplayRuntimeModel({
  models,
  runtimeModelId,
}: {
  models: RuntimeModelRecord[];
  runtimeModelId?: string;
  defaultModelId?: string;
}) {
  return models.find((model) => model.id === runtimeModelId);
}

export function getComposerRuntimeLabel(runtime: Pick<RuntimeRecord, "id" | "name">) {
  void runtime;
  return "Kimi for coding";
}

export function formatKimiModelLabel(modelName: string) {
  const normalizedName = modelName.replace(/^kimi-code\//u, "").toLowerCase();
  if (normalizedName === "kimi-for-coding") return "Kimi for Coding";
  if (normalizedName === "kimi-for-coding-highspeed") return "Kimi for Coding High Speed";
  return modelName;
}

export function getRuntimeSelectionLabel({
  runtimeId,
  runtimeName,
  modelName,
}: {
  runtimeId: RuntimeId;
  runtimeName: string;
  modelName?: string;
}) {
  void runtimeId;
  void runtimeName;
  return modelName ?? "Kimi for Coding";
}

export function supportsRuntimeModelSelection(runtimeId: RuntimeId | null) {
  return runtimeId === "kimi";
}

export function getChatHistoryMode(isReplacement: boolean): "continue" | "replace" {
  return isReplacement ? "replace" : "continue";
}

export function getRuntimeModelIdForSend({
  runtimeModelId,
}: {
  runtimeId?: RuntimeId;
  runtimeModelId?: string;
  defaultModelId?: string;
}) {
  return runtimeModelId;
}

export function getActionablePermissionsForThread({
  pendingPermissions,
  threadId,
}: {
  pendingPermissions: ChatPermissionRequest[];
  threadId: string;
}) {
  return pendingPermissions.filter(
    (permission) =>
      permission.threadId === threadId && permission.provider === "kimi" && !permission.planReview,
  );
}

export function getPendingPlanReviewForThread({
  pendingPermissions,
  threadId,
}: {
  pendingPermissions: ChatPermissionRequest[];
  threadId: string;
}) {
  return (
    pendingPermissions.find(
      (permission) =>
        permission.threadId === threadId &&
        permission.provider === "kimi" &&
        !!permission.planReview,
    ) ?? null
  );
}

export function getPermissionOption(
  permission: ChatPermissionRequest,
  kind: ChatPermissionOptionKind,
) {
  return permission.options.find((option) => option.kind === kind) ?? null;
}

export function getPermissionDetail(permission: ChatPermissionRequest) {
  return (
    permission.command ??
    permission.filePath ??
    permission.description ??
    permission.toolName ??
    permission.action
  );
}

// Approval-mode keyboard shortcuts: y allows once, a allows for the session,
// n rejects once.
export function getPermissionShortcutKind(key: string): ChatPermissionOptionKind | null {
  const normalized = key.toLowerCase();
  if (normalized === "y") {
    return "allow_once";
  }
  if (normalized === "a") {
    return "allow_always";
  }
  if (normalized === "n") {
    return "reject_once";
  }
  return null;
}

export function getSkillSlashTrigger(
  input: string,
  cursorPosition = input.length,
): SkillSlashTrigger | null {
  const cursor = Math.min(Math.max(cursorPosition, 0), input.length);
  const left = input.slice(0, cursor);
  const tokenStart =
    Math.max(left.lastIndexOf(" "), left.lastIndexOf("\n"), left.lastIndexOf("\t")) + 1;
  const token = left.slice(tokenStart);

  if (!token.startsWith("/")) {
    return null;
  }

  const query = token.slice(1);
  if (query.includes("/")) {
    return null;
  }

  return {
    start: tokenStart,
    end: cursor,
    query,
  };
}

export function parseLeadingPlanCommand(input: string) {
  const match = /^\s*\/plan(?=$|\s)(?:[ \t]+)?([\s\S]*)$/u.exec(input);
  if (!match) {
    return null;
  }

  return {
    task: (match[1] ?? "").trimStart(),
  };
}

export function getPlanSubmissionState(
  input: string,
  runtimeId: RuntimeId,
  currentPlanMode: boolean,
) {
  const command = runtimeId === "kimi" ? parseLeadingPlanCommand(input) : null;
  return {
    command,
    task: command?.task ?? input,
    planMode: runtimeId === "kimi" && (currentPlanMode || command !== null),
    attachOnly: command !== null && command.task.trim().length === 0,
  };
}

export function shouldShowPlanSlashSuggestion(
  runtimeId: RuntimeId,
  input: string,
  trigger: SkillSlashTrigger | null,
) {
  if (runtimeId !== "kimi" || !trigger) {
    return false;
  }

  return (
    input.slice(0, trigger.start).trim().length === 0 &&
    "plan".startsWith(trigger.query.trim().toLowerCase())
  );
}

function normalizeSkillQuery(value: string) {
  return value.trim().toLowerCase().replace(/\s+/gu, "-");
}

export function filterSkillsForQuery(skills: SkillRecord[], query: string) {
  const normalizedQuery = normalizeSkillQuery(query);

  return skills
    .map((skill) => {
      const name = normalizeSkillQuery(skill.name);
      const label = normalizeSkillQuery(formatSkillLabel(skill.name));
      const description = skill.description.toLowerCase();
      const score =
        normalizedQuery.length === 0
          ? 0
          : name.startsWith(normalizedQuery)
            ? 0
            : label.startsWith(normalizedQuery)
              ? 1
              : name.includes(normalizedQuery)
                ? 2
                : label.includes(normalizedQuery)
                  ? 3
                  : description.includes(normalizedQuery)
                    ? 4
                    : null;

      return score === null ? null : { skill, score };
    })
    .filter((entry): entry is { skill: SkillRecord; score: number } => entry !== null)
    .sort((a, b) => a.score - b.score || a.skill.name.localeCompare(b.skill.name))
    .map((entry) => entry.skill);
}

export function buildSkillReference(skill: SkillRecord) {
  return `[$${skill.name}](${skill.path})`;
}

type ParsedSkillReference = {
  name: string;
  path: string;
};

// Sent messages prefix Skill references as `[$name](path)`. When such a
// message is pasted back into the Composer, the leading references are
// parsed so they can be restored as Skill chips instead of raw text.
export function parseLeadingSkillReferences(text: string): {
  references: ParsedSkillReference[];
  rest: string;
} {
  const references: ParsedSkillReference[] = [];
  let rest = text;
  const pattern = /^\[\$([^\]\n]+)\]\(([^)\n]+)\)(?:\s+|$)/u;
  let match = pattern.exec(rest);
  while (match) {
    references.push({ name: match[1], path: match[2] });
    rest = rest.slice(match[0].length);
    match = pattern.exec(rest);
  }
  return { references, rest };
}

export function replaceSkillSlashTrigger(
  input: string,
  trigger: SkillSlashTrigger,
  skill: SkillRecord,
) {
  const reference = buildSkillReference(skill);
  const trailingSpace = input[trigger.end] === " " ? "" : " ";
  return `${input.slice(0, trigger.start)}${reference}${trailingSpace}${input.slice(trigger.end)}`;
}

export function Composer(props: ComposerProps) {
  const navigate = useNavigate();
  const {
    appendMessage,
    upsertMessages,
    appendWorkspaceDiffMessage,
    updateMessageAndPruneAfter,
    updateMessageRunStatus,
    updateMessageRunEventCount,
    updateMessageParts,
    updateRunChecklist,
    markThreadActivity,
    upsertThread,
    removeThreadFromState,
    removeMessages,
  } = useThreadContent();
  const { projects, threads, threadRuns, threadActions, recordThreadAction } = useAppState();
  const projectId = props.projectId;
  const project =
    props.mode === "association-draft"
      ? {
          id: props.projectId,
          name: props.projectName,
          workingDirectory: props.projectPath,
        }
      : projectId
        ? (projects.find((item) => item.id === projectId) ?? null)
        : null;
  const {
    runningThreadIds,
    runs: sharedRuns,
    pendingPermissions,
    pendingQuestions,
    respondToPermission,
    send,
    stop,
    observeThread,
  } = useChatRun();
  const { compactingThreadIds, execute: executeThreadAction } = useThreadActions();
  const { runtimes, loading: runtimesLoading, refresh: refreshRuntimes } = useRuntimes();
  const {
    skills,
    loading: skillsLoading,
    error: skillsError,
    refresh: refreshSkills,
  } = useSkills(project?.workingDirectory);
  const { status: mcpServerStatus } = useMcpServer();
  const { showToast } = useToast();
  const threadDraftSnapshotKey = useSyncExternalStore(subscribeToThreadWork, () =>
    getThreadDraftSnapshotKey(props.threadId),
  );
  const initialDraft =
    props.mode === "association-draft" ? props.initialDraft : getThreadDraft(props.threadId);
  const [input, setInput] = useState(() => initialDraft?.content ?? "");
  const [pendingDraftSkillNames, setPendingDraftSkillNames] = useState<string[] | null>(() => {
    const names = initialDraft?.attachedSkillNames ?? [];
    return names.length > 0 ? names : null;
  });
  const pendingDraftSkillNamesRef = useRef(pendingDraftSkillNames);
  pendingDraftSkillNamesRef.current = pendingDraftSkillNames;
  const draftAttachmentsRef = useRef<AttachmentMetadata[] | null>(null);
  if (draftAttachmentsRef.current === null) {
    draftAttachmentsRef.current = initialDraft?.attachments ?? [];
  }
  const draftAttachmentsReadyRef = useRef((draftAttachmentsRef.current ?? []).length === 0);
  // Local Path Context restores straight from the draft (plain path data, no
  // byte reload like attachments). The ref seeds the once-per-mount restore so a
  // peer-window echo does not double-add on re-mount.
  const draftLocalPathContextsRef = useRef<LocalPathContextItem[] | null>(null);
  if (draftLocalPathContextsRef.current === null) {
    draftLocalPathContextsRef.current = initialDraft?.localPathContexts ?? [];
  }
  const draftRestoreCompleteRef = useRef(false);
  const associationDraftChangeRef = useRef<
    ((draft: ThreadWorkDraftSnapshot | null) => void) | null
  >(props.mode === "association-draft" ? props.onDraftChange : null);
  associationDraftChangeRef.current =
    props.mode === "association-draft" ? props.onDraftChange : null;
  const [skillTrigger, setSkillTrigger] = useState<ComposerEditorTrigger | null>(null);
  const [editorStateJson, setEditorStateJson] = useState(initialDraft?.composerState);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [dismissedSkillInput, setDismissedSkillInput] = useState<string | null>(null);
  const [attachedSkills, setAttachedSkills] = useState<SkillRecord[]>([]);
  const [showRuntimePicker, setShowRuntimePicker] = useState(false);
  const [cascadingRuntimeId, setCascadingRuntimeId] = useState<RuntimeId | null>(null);
  const [isPointerOverRuntimeMenu, setIsPointerOverRuntimeMenu] = useState(false);
  const [isPointerOverCascadingPanel, setIsPointerOverCascadingPanel] = useState(false);
  const [cascadingAnchorRect, setCascadingAnchorRect] = useState<RectLike | null>(null);
  const [cascadingPanelPosition, setCascadingPanelPosition] =
    useState<CascadingPanelPosition | null>(null);
  const [showModePicker, setShowModePicker] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [localPathContexts, setLocalPathContexts] = useState<LocalPathContextItem[]>([]);
  const [isPreparingAttachments, setIsPreparingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [threadActionError, setThreadActionError] = useState<string | null>(null);
  const [lightboxAttachmentIndex, setLightboxAttachmentIndex] = useState<number | null>(null);
  const [kimiStatus, setKimiStatus] = useState<KimiSessionStatus | null>(null);
  const [kimiStatusLoadState, setKimiStatusLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [latestCompactBoundary, setLatestCompactBoundary] = useState<AppThreadActionRecord | null>(
    null,
  );
  const [gitBranches, setGitBranches] = useState<string[]>([]);
  const [gitBranchWorktrees, setGitBranchWorktrees] = useState<GitBranchWorktree[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  const composerSourceKey = `${props.mode}:${props.threadId}`;
  const threadDraftSourceKey = `${props.mode}:${props.threadId}:${threadDraftSnapshotKey}`;
  const lastAppliedThreadDraftSourceKeyRef = useRef(threadDraftSourceKey);

  // Applies a shared Thread Composer draft: text and skills are restored
  // synchronously, then attachment bytes are reloaded. Used both by the regular
  // readback path and by the post-composition conflict resolution, so the two
  // paths cannot drift.
  const applySharedThreadDraft = useCallback(
    (draft: ThreadWorkDraftSnapshot | null) => {
      sharedDraftRestoreCleanupRef.current?.();
      const content = draft?.content ?? "";
      const restoredSkills = resolveDraftSkillRecords(skills, draft?.attachedSkillNames ?? []);
      setInput(content);
      setAttachedSkills(restoredSkills);
      setPendingDraftSkillNames(
        draft && draft.attachedSkillNames.length > 0 ? draft.attachedSkillNames : null,
      );
      setEditorStateJson(draft?.composerState);
      editorRef.current?.replaceDraft(content, restoredSkills, draft?.composerState);
      setLocalPathContexts(draft?.localPathContexts ?? []);

      draftRestoreCompleteRef.current = false;
      draftAttachmentsReadyRef.current = (draft?.attachments.length ?? 0) === 0;
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        if (sharedDraftRestoreCleanupRef.current === cancel) {
          sharedDraftRestoreCleanupRef.current = null;
        }
      };
      sharedDraftRestoreCleanupRef.current = cancel;
      void (async () => {
        const { attachments: restored, unavailableNames } = await restoreDraftAttachments(
          draft?.attachments ?? [],
        );
        if (cancelled) {
          restored.forEach((attachment) => {
            if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
          });
          return;
        }
        setPendingAttachments((previous) => {
          previous.forEach((attachment) => {
            if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
          });
          return restored;
        });
        setAttachmentError(
          unavailableNames.length > 0
            ? `文件不可用，请移除或重新添加：${unavailableNames.join(", ")}`
            : null,
        );
        draftAttachmentsReadyRef.current = unavailableNames.length === 0;
        draftRestoreCompleteRef.current = true;
        if (sharedDraftRestoreCleanupRef.current === cancel) {
          sharedDraftRestoreCleanupRef.current = null;
        }
      })();

      return cancel;
    },
    [skills],
  );

  // Single reset point for every composition flag and buffered draft. Called on
  // Thread/mode change (effect body + cleanup) and once a post-composition
  // snapshot is resolved. Keeping it in one place stops those paths from
  // drifting when a flag is added.
  const resetCompositionState = useCallback(() => {
    compositionActiveRef.current = false;
    compositionEndedRef.current = false;
    compositionDraftBaseRef.current = undefined;
    pendingSharedDraftRef.current = undefined;
    setIsCompositionActive(false);
  }, []);

  // IME composition handlers. Stable so ComposerEditor's native listeners are
  // not re-subscribed on every render; they read live state from refs.
  const handleCompositionStart = useCallback(() => {
    if (props.mode !== "thread") return;
    if (compositionActiveRef.current) return;
    compositionActiveRef.current = true;
    setIsCompositionActive(true);
    const { content, attachedSkills, pendingAttachments, localPathContexts, composerState } =
      compositionBaselineInputRef.current;
    compositionDraftBaseRef.current = buildThreadDraftSnapshot({
      content,
      attachedSkills,
      pendingAttachments,
      localPathContexts,
      composerState,
    });
    pendingSharedDraftRef.current = undefined;
  }, [props.mode]);
  const handleCompositionEnd = useCallback(() => {
    // compositionend fires before Lexical commits its final state. Mark the
    // composition as ended so the next post-composition onSnapshot resolves the
    // shared-draft conflict and clears the composition flags.
    if (!compositionActiveRef.current) return;
    compositionEndedRef.current = true;
  }, []);

  useEffect(() => {
    if (props.mode !== "thread") return;
    if (lastAppliedThreadDraftSourceKeyRef.current === threadDraftSourceKey) return;
    const draft = getThreadDraft(props.threadId);
    // Read the latest local state from a ref instead of the effect closure.
    // applySharedThreadDraft calls setInput, which (via onSnapshot) changes the
    // local state; if this effect compared against the stale closure value it
    // would keep re-applying its own write (apply -> persist -> readback ->
    // apply ...), clobbering the caret. The ref is reassigned on every render,
    // so by the time this passive effect runs it holds the committed value.
    const {
      content,
      attachedSkills: liveSkills,
      pendingAttachments: livePending,
      localPathContexts: liveLocalPathContexts,
      composerState,
    } = compositionBaselineInputRef.current;
    const currentDraft = buildThreadDraftSnapshot({
      content,
      attachedSkills: liveSkills,
      pendingAttachments: livePending,
      localPathContexts: liveLocalPathContexts,
      composerState,
    });
    // Compare only the semantic fields (content/skills/attachments/path contexts).
    // `composerState` is excluded: it is the local editor's serialized state,
    // which changes on every keystroke (node keys, selection offsets). Including
    // it here would make a locally-typed draft always look "different" from the
    // just-persisted one, causing readback to clobber the editor mid-typing and
    // echo-loop (apply -> persist -> readback -> apply ...) until focus is lost.
    if (draftsContentEqual(draft, currentDraft)) {
      lastAppliedThreadDraftSourceKeyRef.current = threadDraftSourceKey;
      return;
    }
    // While IME composition is active, do not touch the editor. Buffer the
    // latest shared draft so compositionend can decide whether to apply it.
    if (compositionActiveRef.current) {
      pendingSharedDraftRef.current = draft;
      return;
    }
    lastAppliedThreadDraftSourceKeyRef.current = threadDraftSourceKey;
    // TEMP: diagnostic to confirm readback is what steals focus while typing.
    // Remove once the occasional focus-loss report is resolved.
    console.warn("[composer-readback] applying shared draft over local input", {
      threadId: props.threadId,
      storeContent: draft?.content ?? null,
      localContent: content,
    });
    return applySharedThreadDraft(draft);
  }, [props.mode, props.threadId, skills, threadDraftSourceKey, applySharedThreadDraft]);
  // A buffered shared draft and the composition baseline belong to the
  // Thread/mode that was active when composition started. On unmount, Thread
  // switch, or mode change they must be dropped so a stale draft is never
  // applied to the wrong Thread.
  useEffect(() => {
    // Only commit the state reset when composition was actually live, to avoid
    // a needless render on every Thread/mode switch.
    if (compositionActiveRef.current) resetCompositionState();
    return () => {
      sharedDraftRestoreCleanupRef.current?.();
      draftRestoreCompleteRef.current = true;
      resetCompositionState();
    };
  }, [props.mode, props.threadId, resetCompositionState]);
  const [newBranchName, setNewBranchName] = useState(CREATE_BRANCH_DEFAULT_NAME);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [showCreateBranchInput, setShowCreateBranchInput] = useState(false);
  const editorRef = useRef<ComposerEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runtimePickerRef = useRef<HTMLDivElement>(null);
  const cascadingPanelRef = useRef<HTMLDivElement>(null);
  const modePickerRef = useRef<HTMLDivElement>(null);
  const branchPickerRef = useRef<HTMLDivElement>(null);
  const skillItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const runtimeCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTypewriterRef = useRef<VoidFunction | null>(null);
  const wasSendingRef = useRef(false);
  const wasSendingForQueueRef = useRef(false);
  const queueDrainRequestedRef = useRef(false);
  const workspaceDiffCapturePendingRef = useRef(false);
  const pendingWorkspaceDiffCaptureRef = useRef<Promise<void> | null>(null);
  // Tracks the in-flight diff capture so a new send can wait for it; the
  // capture appends its own message, and without this ordering its block
  // lands after the next turn's messages.
  const trackWorkspaceDiffCapture = (capture: Promise<void>) => {
    pendingWorkspaceDiffCaptureRef.current = capture;
    void capture.finally(() => {
      if (pendingWorkspaceDiffCaptureRef.current === capture) {
        pendingWorkspaceDiffCaptureRef.current = null;
      }
    });
  };
  const [queueDrainVersion, setQueueDrainVersion] = useState(0);
  const [stopGuarded, setStopGuarded] = useState(() => getStopGuardRemainingMs(props.threadId) > 0);
  const lastSubmitRequestIdRef = useRef<number | null>(null);
  const lastDraftRequestIdRef = useRef<number | null>(null);
  const steerItemRef = useRef<QueuedChatMessage | null>(null);
  const editingQueuedIdRef = useRef<string | null>(null);
  // IME composition coordination. While a composition is active, shared Thread
  // Composer State updates must not rewrite the editor (they would clear IME
  // candidates), and the debounced persistence must not write unconfirmed IME
  // text. compositionActiveRef gates readback and persistence; compositionEndedRef
  // is set by compositionend and resolved against the final post-composition
  // snapshot (which Lexical publishes after compositionend). The state value
  // cancels an already scheduled persistence effect; refs let native event and
  // timeout callbacks observe the current composition synchronously.
  const [isCompositionActive, setIsCompositionActive] = useState(false);
  const compositionActiveRef = useRef(false);
  const compositionEndedRef = useRef(false);
  const compositionDraftBaseRef = useRef<ThreadWorkDraftSnapshot | null | undefined>(undefined);
  const pendingSharedDraftRef = useRef<ThreadWorkDraftSnapshot | null | undefined>(undefined);
  const sharedDraftRestoreCleanupRef = useRef<(() => void) | null>(null);
  // Mirror the snapshot inputs into refs so the compositionstart callback (a
  // stable native-listener closure) captures the baseline from current state
  // without re-subscribing the listener on every keystroke.
  const compositionBaselineInputRef = useRef({
    content: input,
    attachedSkills,
    pendingAttachments,
    localPathContexts,
    composerState: editorStateJson,
  });
  compositionBaselineInputRef.current = {
    content: input,
    attachedSkills,
    pendingAttachments,
    localPathContexts,
    composerState: editorStateJson,
  };
  const threadId = props.threadId;
  const thread =
    props.mode === "association-draft"
      ? null
      : (threads.find((item) => item.id === threadId && item.projectId === projectId) ?? null);
  const sessionStatusContextKey = [
    props.workspaceId,
    projectId,
    project?.workingDirectory ?? "",
    threadId,
    props.runtimeId,
    props.runtimeModelId ?? "",
    props.runtimeMode,
  ].join("\0");
  const {
    snapshot: sessionStatusSnapshot,
    loading: isSessionStatusLoading,
    error: sessionStatusError,
    begin: beginSessionStatus,
    succeed: succeedSessionStatus,
    fail: failSessionStatus,
    dismiss: dismissSessionStatus,
    clear: clearSessionStatus,
    reportError: reportSessionStatusError,
  } = useSessionStatus(threadId, sessionStatusContextKey);
  const sessionStatusContextKeyRef = useRef(sessionStatusContextKey);
  sessionStatusContextKeyRef.current = sessionStatusContextKey;
  const runChecklist = thread?.runChecklist;
  const queuedMessages = useQueuedMessages(threadId);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [editingQueuedText, setEditingQueuedText] = useState("");

  const requestQueueDrain = () => {
    queueDrainRequestedRef.current = true;
    setQueueDrainVersion((version) => version + 1);
  };

  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  const isPreparingAttachmentsRef = useRef(false);
  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);
  useEffect(() => {
    return () => {
      pendingAttachmentsRef.current.forEach((pending) => {
        if (pending.previewUrl) {
          URL.revokeObjectURL(pending.previewUrl);
        }
      });
    };
  }, []);

  const commitQueuedEdit = () => {
    const queuedId = editingQueuedIdRef.current;
    if (!queuedId) {
      return;
    }
    const content = editingQueuedText.trim();
    if (content) {
      updateQueuedChatMessage(threadId, queuedId, content);
    }
    editingQueuedIdRef.current = null;
    setEditingQueuedId(null);
    setEditingQueuedText("");
  };

  const cancelQueuedEdit = () => {
    editingQueuedIdRef.current = null;
    setEditingQueuedId(null);
    setEditingQueuedText("");
  };

  const refreshKimiStatus = useCallback(async () => {
    if (props.runtimeId !== "kimi") {
      return;
    }

    setKimiStatusLoadState("loading");

    const context = {
      kind: "project" as const,
      projectId: props.projectId,
      workingDirectory: project?.workingDirectory ?? "",
      workspaceId: props.workspaceId,
    };

    try {
      const status = await window.carrent.chat.getKimiStatus({
        context,
        threadId,
        runtimeId: props.runtimeId,
        runtimeModelId: getRuntimeModelIdForSend({
          runtimeId: props.runtimeId,
          runtimeModelId: props.runtimeModelId,
        }),
        runtimeMode: props.runtimeMode,
        planMode: false,
        transcript: [],
        message: "",
      });
      setKimiStatus(status);
      setKimiStatusLoadState("ready");
    } catch {
      setKimiStatusLoadState("error");
    }
  }, [
    props.mode,
    projectId,
    project?.workingDirectory,
    threadId,
    props.runtimeId,
    props.runtimeModelId,
    props.runtimeMode,
  ]);

  const runtimeOptions = useMemo(() => getChatRuntimeOptions(runtimes), [runtimes]);
  const modelRuntimeId = supportsRuntimeModelSelection(props.runtimeId) ? props.runtimeId : null;
  const { models, defaultModelId } = useRuntimeModels(modelRuntimeId);
  const {
    models: kimiMenuModels,
    defaultModelId: kimiMenuDefaultModelId,
    loading: kimiMenuLoading,
  } = useRuntimeModels(showRuntimePicker ? "kimi" : null);
  const cascadingModelRuntimeId = supportsRuntimeModelSelection(cascadingRuntimeId)
    ? cascadingRuntimeId
    : null;
  const { models: cascadingModels, loading: cascadingLoading } =
    useRuntimeModels(cascadingModelRuntimeId);
  const selectedRuntimeModel = getDisplayRuntimeModel({
    models,
    runtimeModelId: props.runtimeModelId,
  });
  const activeRuntimeModel =
    selectedRuntimeModel ??
    (props.runtimeId === "kimi"
      ? (models.find((model) => model.id === defaultModelId) ?? models[0])
      : undefined);
  const selectedRuntime = runtimes.find((runtime) => runtime.id === props.runtimeId);
  const isSelectedRuntimeAvailable = isChatRuntimeAvailable(props.runtimeId, runtimes);
  const runtimeSetupRequired =
    props.runtimeId === "kimi" &&
    !runtimesLoading &&
    !!selectedRuntime &&
    selectedRuntime.availability !== "detected";
  const runtimeButtonLabel = runtimesLoading
    ? "Checking runtimes"
    : runtimeOptions.length === 0
      ? "No runtime available"
      : isSelectedRuntimeAvailable
        ? getRuntimeSelectionLabel({
            runtimeId: props.runtimeId,
            runtimeName: selectedRuntime
              ? getComposerRuntimeLabel(selectedRuntime)
              : runtimeNameMap[props.runtimeId],
            modelName: activeRuntimeModel?.name,
          })
        : "Select runtime";
  const localMcpSkillsDisabled = props.runtimeId === "kimi" && !mcpServerStatus.enabled;
  const skillMenuOpen = !!skillTrigger && !localMcpSkillsDisabled;
  useEffect(() => {
    if (skillMenuOpen) {
      void refreshSkills();
    }
  }, [refreshSkills, skillMenuOpen]);
  const filteredSkills = useMemo(
    () =>
      skillTrigger && !localMcpSkillsDisabled
        ? filterSkillsForQuery(skills, skillTrigger.query)
        : [],
    [localMcpSkillsDisabled, skillTrigger, skills],
  );
  const isThreadCompacting = compactingThreadIds.includes(threadId);
  const isThreadSending = runningThreadIds.includes(threadId);
  const sharedRun = [...sharedRuns].reverse().find((run) => run.threadId === threadId);
  const persistedRun = sharedRun
    ? [...threadRuns].reverse().find((run) => run.id === sharedRun.runId)
    : undefined;
  const sharedRunUserMessageIndex = persistedRun
    ? props.messages.findIndex((message) => message.id === persistedRun.messageId)
    : -1;
  const sharedRunAssistantMessage = persistedRun?.assistantMessageId
    ? props.messages.find((message) => message.id === persistedRun.assistantMessageId)
    : sharedRunUserMessageIndex >= 0
      ? props.messages
          .slice(sharedRunUserMessageIndex + 1)
          .find((message) => message.role === "assistant" && message.runStatus === "running")
      : undefined;

  useEffect(() => {
    if (
      props.mode !== "thread" ||
      !sharedRun ||
      !persistedRun ||
      !sharedRunAssistantMessage ||
      (isTerminalSharedChatRunStatus(sharedRun.status) &&
        (sharedRunAssistantMessage.runEventCount ?? 0) >=
          (sharedRun.eventCount ?? sharedRun.events.length))
    ) {
      return;
    }
    const assistantMessageId = sharedRunAssistantMessage.id;
    const appliedEventCount = sharedRunAssistantMessage.runEventCount ?? 0;
    let receivedRunText =
      sharedRun.events.find((event) => event.type === "text-snapshot")?.text ??
      sharedRun.events
        .slice(0, appliedEventCount)
        .filter((event) => event.type === "delta")
        .map((event) => event.text)
        .join("");
    const updatePart = (update: Parameters<typeof updateMessageParts>[1]) =>
      updateMessageParts(assistantMessageId, update);

    return observeThread(
      threadId,
      {
        onStarted: (runId) => updateRunChecklist(threadId, { kind: "started", runId }),
        onDelta: (content) => {
          receivedRunText += content;
          updatePart({ kind: "append-text", content });
        },
        onTextSnapshot: (content) => {
          receivedRunText = content;
          updatePart({ kind: "replace-text", content });
        },
        onReasoning: (reasoning) =>
          updatePart({ kind: "upsert-reasoning", reasoning: { type: "reasoning", ...reasoning } }),
        onKimiTimeline: (item) => updatePart({ kind: "upsert-kimi-timeline", item }),
        onShell: (shell) =>
          updatePart({ kind: "upsert-shell", shell: { type: "shell", ...shell } }),
        onSubagentTask: (task) =>
          updatePart({ kind: "upsert-subagent-task", task: { type: "subagent_task", ...task } }),
        onChecklist: (checklist, owner) =>
          updateRunChecklist(owner.threadId, {
            kind: "snapshot",
            runId: owner.runId,
            runtimeId: owner.runtimeId,
            entries: checklist.entries,
          }),
        onPermissionRequested: (permission) => {
          markThreadActivity(threadId, Date.parse(permission.createdAt));
          if (!permission.planReview) return;
          updatePart({
            kind: "upsert-plan-review",
            review: {
              type: "plan_review",
              id: `plan-review-${permission.id}`,
              permissionId: permission.id,
              content: permission.planReview.content,
              status: "pending",
              options: permission.options,
            },
          });
        },
        onPermissionResolved: (resolution) =>
          updatePart({
            kind: "resolve-plan-review",
            permissionId: resolution.permissionId,
            status:
              resolution.optionId === "plan_revise"
                ? "revision-requested"
                : resolution.optionId === "plan_reject_and_exit"
                  ? "rejected"
                  : "approved",
            selectedOptionId: resolution.optionId,
            selectedOptionName: resolution.optionName,
          }),
        onPermissionsInterrupted: (permissions) => {
          if (permissions.some((permission) => permission.planReview)) {
            updatePart({ kind: "interrupt-plan-reviews" });
          }
        },
        onQuestionRequested: (question) =>
          updatePart({
            kind: "upsert-question",
            question: {
              type: "question",
              id: `question-${question.id}`,
              questionId: question.id,
              status: "pending",
              questions: question.questions.map(({ header, question: text }) => ({
                header,
                question: text,
              })),
            },
          }),
        onQuestionResolved: ({ question, outcome, answers }) => {
          const draftState = getQuestionDraftState(question.id);
          const answerDrafts = answers
            ? getQuestionDraftsFromAnswers(question, answers)
            : draftState?.drafts;
          updatePart({
            kind: "resolve-question",
            questionId: question.id,
            status: outcome === "answered" ? "answered" : "skipped",
            ...(outcome === "answered" && answerDrafts
              ? { answers: buildQuestionAnswerRecords(question, answerDrafts) }
              : {}),
          });
          clearQuestionDraftState(question.id);
        },
        onQuestionsInterrupted: (questions) => {
          updatePart({ kind: "interrupt-questions" });
          questions.forEach((question) => clearQuestionDraftState(question.id));
        },
        onComplete: (text, runId) => {
          updateRunChecklist(threadId, { kind: "outcome", runId, outcome: "completed" });
          const missingText = getMissingRunCompletionText(receivedRunText, text);
          if (missingText) updatePart({ kind: "append-text", content: missingText });
          updatePart({ kind: "interrupt-subagent-tasks" });
          updateMessageRunStatus(assistantMessageId, "completed");
          markThreadActivity(threadId);
        },
        onError: (error, runId, _writtenFiles, runtimeSessionRecovery) => {
          if (runId) updateRunChecklist(threadId, { kind: "outcome", runId, outcome: "failed" });
          updatePart({ kind: "interrupt-subagent-tasks" });
          updatePart({
            kind: "upsert-error",
            error: {
              type: "error",
              id: `error-${assistantMessageId}`,
              message: error,
              ...(runtimeSessionRecovery
                ? {
                    runtimeSessionRecovery: {
                      ...runtimeSessionRecovery,
                      userMessageId: persistedRun.messageId,
                    },
                  }
                : {}),
            },
          });
          updateMessageRunStatus(assistantMessageId, "failed");
          markThreadActivity(threadId);
        },
        onStop: (runId) => {
          updateRunChecklist(threadId, { kind: "outcome", runId, outcome: "cancelled" });
          updatePart({ kind: "interrupt-subagent-tasks" });
          updateMessageRunStatus(assistantMessageId, "cancelled");
          markThreadActivity(threadId);
        },
        onEventApplied: (count) => updateMessageRunEventCount(assistantMessageId, count),
      },
      appliedEventCount,
    );
  }, [
    markThreadActivity,
    observeThread,
    persistedRun,
    props.mode,
    sharedRun,
    sharedRunAssistantMessage,
    threadId,
    updateMessageParts,
    updateMessageRunEventCount,
    updateMessageRunStatus,
    updateRunChecklist,
  ]);
  useEffect(() => {
    if (!isThreadSending) return;
    const remainingMs = getStopGuardRemainingMs(threadId);
    if (remainingMs <= 0) {
      setStopGuarded(false);
      return;
    }
    setStopGuarded(true);
    const entry = stopGuardByThread.get(threadId);
    if (!entry) return;
    scheduleStopGuardExpiry(threadId, entry, () => setStopGuarded(false));
    return () => scheduleStopGuardExpiry(threadId, entry);
  }, [isThreadSending, threadId]);
  const compactAvailability = useMemo(
    () =>
      getCompactAvailability({
        runtimeId: props.runtimeId,
        status: kimiStatus,
        running: isThreadSending,
        compacting: isThreadCompacting,
        statusLoading: isSessionStatusLoading,
        messages: props.messages,
        runs: threadRuns.filter((run) => run.threadId === threadId),
        actions: [
          ...threadActions.filter((action) => action.threadId === threadId),
          ...(latestCompactBoundary?.threadId === threadId ? [latestCompactBoundary] : []),
        ],
      }),
    [
      isThreadCompacting,
      isThreadSending,
      isSessionStatusLoading,
      kimiStatus,
      latestCompactBoundary,
      props.messages,
      props.runtimeId,
      threadActions,
      threadId,
      threadRuns,
    ],
  );
  const showPlanSuggestion =
    !isThreadCompacting &&
    dismissedSkillInput !== input &&
    shouldShowPlanSlashSuggestion(props.runtimeId, input, skillTrigger);
  const showCompactSuggestion =
    compactAvailability.available &&
    !!skillTrigger &&
    dismissedSkillInput !== input &&
    "compact".startsWith(skillTrigger.query.toLocaleLowerCase());
  const statusAvailable =
    props.mode === "thread" &&
    props.runtimeId === "kimi" &&
    !!project?.workingDirectory &&
    !!kimiStatus?.supportedCommands.includes("status") &&
    !isThreadSending &&
    !isThreadCompacting &&
    !isSessionStatusLoading;
  const showStatusSuggestion =
    statusAvailable &&
    !!skillTrigger &&
    input.slice(0, skillTrigger.start).trim().length === 0 &&
    dismissedSkillInput !== input &&
    "status".startsWith(skillTrigger.query.toLocaleLowerCase());
  const showSkills =
    !!skillTrigger &&
    !localMcpSkillsDisabled &&
    dismissedSkillInput !== input &&
    (skillsLoading || !!skillsError || filteredSkills.length > 0 || skillTrigger.query.length > 0);
  const showSlashMenu =
    showPlanSuggestion || showCompactSuggestion || showStatusSuggestion || showSkills;
  const carrentCommandMenuItemCount =
    (showPlanSuggestion ? 1 : 0) + (showCompactSuggestion ? 1 : 0) + (showStatusSuggestion ? 1 : 0);
  const slashMenuItemCount = carrentCommandMenuItemCount + filteredSkills.length;

  const effectiveAttachedSkills = localMcpSkillsDisabled ? [] : attachedSkills;
  const hasSendableContent = canSubmitComposerContent({
    content: input,
    attachedSkillCount: effectiveAttachedSkills.length,
    attachmentCount: pendingAttachments.length,
    localPathContextCount: localPathContexts.length,
    isPreparingAttachments,
    hasUnavailableAttachments: hasUnavailablePendingAttachments(pendingAttachments),
  });
  const canSend =
    hasSendableContent &&
    !!project &&
    isSelectedRuntimeAvailable &&
    !isThreadCompacting &&
    !isSessionStatusLoading;
  const threadPermissions = useMemo(
    () => getActionablePermissionsForThread({ pendingPermissions, threadId }),
    [pendingPermissions, threadId],
  );
  const pendingPlanReview = useMemo(
    () => getPendingPlanReviewForThread({ pendingPermissions, threadId }),
    [pendingPermissions, threadId],
  );
  const threadQuestion = useMemo(
    () => getPendingQuestionForThread({ pendingQuestions, threadId }),
    [pendingQuestions, threadId],
  );
  const showCascadingPanel =
    showRuntimePicker && !!cascadingModelRuntimeId && !!props.onRuntimeModelIdChange;
  const cascadingPanelTransitionClass = !cascadingPanelPosition
    ? "pointer-events-none opacity-0 translate-y-1 scale-95"
    : "opacity-100 translate-x-0 translate-y-0 scale-100";
  const visibleGitBranches = useMemo(() => {
    const query = branchSearchQuery.trim().toLowerCase();
    return gitBranches.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchSearchQuery, gitBranches]);
  const worktreeBranchNames = useMemo(
    () => new Set(gitBranchWorktrees.map((worktree) => worktree.branch)),
    [gitBranchWorktrees],
  );
  const visibleLocalBranches = useMemo(
    () =>
      visibleGitBranches.filter(
        (branch) => branch === currentBranch || !worktreeBranchNames.has(branch),
      ),
    [currentBranch, visibleGitBranches, worktreeBranchNames],
  );
  const visibleWorktreeBranches = useMemo(
    () =>
      visibleGitBranches.filter(
        (branch) => branch !== currentBranch && worktreeBranchNames.has(branch),
      ),
    [currentBranch, visibleGitBranches, worktreeBranchNames],
  );

  const closeRuntimePicker = () => {
    if (runtimeCloseTimerRef.current) {
      clearTimeout(runtimeCloseTimerRef.current);
      runtimeCloseTimerRef.current = null;
    }
    setShowRuntimePicker(false);
    setCascadingRuntimeId(null);
    setCascadingAnchorRect(null);
    setCascadingPanelPosition(null);
    setIsPointerOverRuntimeMenu(false);
    setIsPointerOverCascadingPanel(false);
  };

  const scheduleRuntimePickerClose = () => {
    if (runtimeCloseTimerRef.current) {
      clearTimeout(runtimeCloseTimerRef.current);
    }

    runtimeCloseTimerRef.current = setTimeout(() => {
      runtimeCloseTimerRef.current = null;
      closeRuntimePicker();
    }, 120);
  };

  useEffect(() => {
    return () => {
      flushTypewriterRef.current?.();
      if (runtimeCloseTimerRef.current) {
        clearTimeout(runtimeCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setKimiStatusLoadState("loading");
  }, [threadId, props.runtimeId, projectId, project?.workingDirectory]);

  useEffect(() => {
    void refreshKimiStatus();
  }, [refreshKimiStatus]);

  useEffect(() => {
    if (wasSendingRef.current && !isThreadSending) {
      void refreshKimiStatus();
    }
    wasSendingRef.current = isThreadSending;
  }, [isThreadSending, refreshKimiStatus]);

  useEffect(() => {
    if (!sessionStatusSnapshot) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissSessionStatus();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [dismissSessionStatus, sessionStatusSnapshot]);

  useEffect(() => {
    if (!project?.workingDirectory) {
      setGitBranches([]);
      setGitBranchWorktrees([]);
      setCurrentBranch(null);
      setNewBranchName(CREATE_BRANCH_DEFAULT_NAME);
      setShowCreateBranchInput(false);
      return;
    }

    let cancelled = false;
    setGitLoading(true);

    void (async () => {
      try {
        const git = getGitBridge(window.carrent);
        const info = normalizeGitBranchInfo(await git.branches(project.workingDirectory));
        if (!cancelled) {
          setGitBranches(info.branches);
          setGitBranchWorktrees(info.branchWorktrees);
          setCurrentBranch(info.current);
        }
      } catch (error) {
        if (!cancelled) {
          setGitBranches([]);
          setGitBranchWorktrees([]);
          setCurrentBranch(null);
          showToast(getGitToastMessage(error), "error");
        }
      } finally {
        if (!cancelled) {
          setGitLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project?.workingDirectory, showToast]);

  const handleCreateBranch = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!project?.workingDirectory || creatingBranch) {
        return;
      }

      const branchName = newBranchName.trim();
      if (!branchName) {
        showToast("Branch name is required.", "error");
        return;
      }

      setCreatingBranch(true);
      try {
        const git = getGitBridge(window.carrent);
        if (typeof git.createBranch !== "function") {
          throw new Error("Git branch creation is unavailable. Restart Carrent and try again.");
        }
        const info = normalizeGitBranchInfo(
          await git.createBranch(project.workingDirectory, branchName),
        );
        setCurrentBranch(info.current);
        setGitBranches(info.branches);
        setGitBranchWorktrees(info.branchWorktrees);
        setShowBranchPicker(false);
        setBranchSearchQuery("");
        setNewBranchName(CREATE_BRANCH_DEFAULT_NAME);
        setShowCreateBranchInput(false);
      } catch (error) {
        showToast(getGitToastMessage(error), "error");
      } finally {
        setCreatingBranch(false);
      }
    },
    [creatingBranch, newBranchName, project?.workingDirectory, showToast],
  );

  useEffect(() => {
    if (!showBranchPicker) {
      setShowCreateBranchInput(false);
      setNewBranchName(CREATE_BRANCH_DEFAULT_NAME);
    }
  }, [showBranchPicker]);

  useEffect(() => {
    if (!showRuntimePicker && !showModePicker && !showBranchPicker) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        showRuntimePicker &&
        runtimePickerRef.current &&
        !runtimePickerRef.current.contains(target) &&
        !(cascadingPanelRef.current && cascadingPanelRef.current.contains(target))
      ) {
        closeRuntimePicker();
      }
      if (showModePicker && modePickerRef.current && !modePickerRef.current.contains(target)) {
        setShowModePicker(false);
      }
      if (
        showBranchPicker &&
        branchPickerRef.current &&
        !branchPickerRef.current.contains(target)
      ) {
        setShowBranchPicker(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showRuntimePicker) {
          closeRuntimePicker();
        }
        if (showModePicker) {
          setShowModePicker(false);
        }
        if (showBranchPicker) {
          setShowBranchPicker(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showRuntimePicker, showModePicker, showBranchPicker]);

  useEffect(() => {
    setSelectedSkillIndex(0);
  }, [
    skillTrigger?.query,
    filteredSkills.length,
    showPlanSuggestion,
    showCompactSuggestion,
    showStatusSuggestion,
  ]);

  useEffect(() => {
    if (!showSlashMenu) {
      return;
    }

    const selectedButton = skillItemRefs.current.get(selectedSkillIndex);
    if (selectedButton) {
      selectedButton.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedSkillIndex, showSlashMenu]);

  useEffect(() => {
    if (!showRuntimePicker || !cascadingRuntimeId) {
      return;
    }

    if (isPointerOverRuntimeMenu || isPointerOverCascadingPanel) {
      if (runtimeCloseTimerRef.current) {
        clearTimeout(runtimeCloseTimerRef.current);
        runtimeCloseTimerRef.current = null;
      }
      return;
    }

    scheduleRuntimePickerClose();
  }, [
    cascadingRuntimeId,
    isPointerOverCascadingPanel,
    isPointerOverRuntimeMenu,
    showRuntimePicker,
  ]);

  const updateCascadingPanelPosition = useCallback(() => {
    if (!showRuntimePicker || !cascadingRuntimeId || !cascadingAnchorRect) {
      return;
    }

    const panelElement = cascadingPanelRef.current;
    if (!panelElement) {
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    if (panelRect.width <= 0 || panelRect.height <= 0) {
      return;
    }

    setCascadingPanelPosition(
      getCascadingPanelPosition(
        cascadingAnchorRect,
        {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        {
          width: panelRect.width,
          height: panelRect.height,
        },
      ),
    );
  }, [cascadingAnchorRect, cascadingRuntimeId, showRuntimePicker]);

  useLayoutEffect(() => {
    if (!showRuntimePicker || !cascadingRuntimeId || !cascadingAnchorRect) {
      return;
    }

    updateCascadingPanelPosition();
  }, [
    cascadingAnchorRect,
    cascadingRuntimeId,
    cascadingLoading,
    cascadingModels.length,
    props.runtimeModelId,
    showRuntimePicker,
    updateCascadingPanelPosition,
  ]);

  useEffect(() => {
    if (!showRuntimePicker || !cascadingRuntimeId || !cascadingAnchorRect) {
      return;
    }

    const handleWindowUpdate = () => {
      updateCascadingPanelPosition();
    };

    window.addEventListener("resize", handleWindowUpdate);
    window.addEventListener("scroll", handleWindowUpdate, true);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            handleWindowUpdate();
          });

    if (observer && cascadingPanelRef.current) {
      observer.observe(cascadingPanelRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleWindowUpdate);
      window.removeEventListener("scroll", handleWindowUpdate, true);
      observer?.disconnect();
    };
  }, [cascadingAnchorRect, cascadingRuntimeId, showRuntimePicker, updateCascadingPanelPosition]);

  const handleAddFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || isPreparingAttachmentsRef.current) {
        return;
      }

      const fileArray = Array.from(files);
      const validation = validateAttachmentSelection([
        ...pendingAttachments.map((pending) => pending.file),
        ...fileArray,
      ]);

      if (!validation.ok) {
        setAttachmentError(validation.reason);
        return;
      }

      setAttachmentError(null);
      isPreparingAttachmentsRef.current = true;
      setIsPreparingAttachments(true);

      let activeFileName = "files";
      try {
        for (const file of fileArray) {
          activeFileName = file.name;
          const metadata = await storeAttachmentFile(file, window.carrent?.attachments);
          const pendingAttachment = pendingAttachmentFromFile(file, metadata);
          setPendingAttachments((prev) => [...prev, pendingAttachment]);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setAttachmentError(`Failed to attach ${activeFileName}: ${message}`);
      } finally {
        isPreparingAttachmentsRef.current = false;
        setIsPreparingAttachments(false);
      }
    },
    [pendingAttachments],
  );

  const handleRemovePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  // Merges resolved Local Path Context items into the composition, deduplicating
  // by normalized identity so a repeated drop of the same path does not stack.
  // The parent surface has already resolved the DOM File objects and shown a
  // toast for any rejected entries; this only accepts the valid items.
  const addLocalPathContexts = useCallback((items: LocalPathContextItem[]) => {
    if (items.length === 0) return;
    setLocalPathContexts((prev) => dedupeLocalPathContexts([...prev, ...items]));
  }, []);

  const handleRemoveLocalPathContext = useCallback((path: string, kind: LocalPathContextKind) => {
    setLocalPathContexts((prev) => prev.filter((item) => item.path !== path || item.kind !== kind));
  }, []);

  const handleRevealLocalPathContext = useCallback(
    async (path: string, basename: string) => {
      try {
        const result = await window.carrent.shell.revealPath(path);
        if (!result.revealed) {
          showToast(`Could not reveal “${basename}”: the path no longer exists.`, "error");
        }
      } catch {
        showToast(`Could not reveal “${basename}” in the file manager.`, "error");
      }
    },
    [showToast],
  );

  useEffect(() => {
    const ref = props.localPathContextAddRef;
    if (!ref) return;
    ref.current = addLocalPathContexts;
    return () => {
      ref.current = null;
    };
  }, [addLocalPathContexts, props.localPathContextAddRef]);

  const resolvePastedComposerContent = useCallback(
    (text: string) => {
      if (localMcpSkillsDisabled) return null;
      const { references, rest } = parseLeadingSkillReferences(text);
      if (references.length === 0) return null;

      const resolvedSkills: SkillRecord[] = [];
      const unresolvedReferences: string[] = [];
      for (const reference of references) {
        const skill = skills.find(
          (item) => item.name === reference.name && item.path === reference.path,
        );
        if (!skill) {
          unresolvedReferences.push(`[$${reference.name}](${reference.path})`);
        } else if (!resolvedSkills.some((item) => item.path === skill.path)) {
          resolvedSkills.push(skill);
        }
      }
      if (resolvedSkills.length === 0) return null;
      return {
        skills: resolvedSkills,
        text: [...unresolvedReferences, rest].filter(Boolean).join(" "),
      };
    },
    [localMcpSkillsDisabled, skills],
  );

  const handleStatus = async (removeMenuQuery = false) => {
    if (removeMenuQuery && skillTrigger) {
      editorRef.current?.removeSlashTrigger();
    }
    setDismissedSkillInput(input);
    if (!statusAvailable || !project?.workingDirectory) {
      reportSessionStatusError("Status is unavailable for this runtime.");
      return false;
    }

    const requestId = beginSessionStatus();
    if (requestId === null) return false;
    const requestContextKey = sessionStatusContextKey;
    try {
      const status = await window.carrent.chat.getSessionStatus({
        context: {
          kind: "project",
          projectId: props.projectId,
          workingDirectory: project.workingDirectory,
          workspaceId: props.workspaceId,
        },
        threadId,
        runtimeId: props.runtimeId,
        runtimeModelId: getRuntimeModelIdForSend({
          runtimeId: props.runtimeId,
          runtimeModelId: props.runtimeModelId,
        }),
        runtimeMode: props.runtimeMode,
        planMode: false,
        transcript: [],
        message: "",
      });
      if (!status) throw new Error("Session status is unavailable.");
      const displayed = succeedSessionStatus(requestId, status);
      if (displayed && sessionStatusContextKeyRef.current === requestContextKey) {
        setKimiStatus(status);
      }
      return displayed;
    } catch {
      failSessionStatus(requestId, "Unable to load session status.");
      return false;
    }
  };

  const handleCompact = async (removeMenuQuery = false) => {
    if (removeMenuQuery && skillTrigger) {
      editorRef.current?.removeSlashTrigger();
    }
    setDismissedSkillInput(input);
    if (!compactAvailability.available) {
      setThreadActionError(getCompactUnavailableMessage(compactAvailability.reason));
      return false;
    }
    if (!project?.workingDirectory) {
      setThreadActionError("Project Working Directory is unavailable.");
      return false;
    }

    setThreadActionError(null);
    try {
      const result = await executeThreadAction({
        action: "compact",
        threadId,
        runtimeId: props.runtimeId,
        workingDirectory: project.workingDirectory,
      });
      const boundary: AppThreadActionRecord = {
        id: `thread-action-${crypto.randomUUID()}`,
        threadId: result.threadId,
        action: result.action,
        runtimeId: result.runtimeId,
        completedAt: result.completedAt,
      };
      setLatestCompactBoundary(boundary);
      const recorded = await recordThreadAction(boundary);
      if (!recorded) {
        throw new Error("Compact completed, but its history boundary could not be saved.");
      }
      await refreshKimiStatus();
      return true;
    } catch (error) {
      await refreshKimiStatus();
      setThreadActionError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };

  const handleSend = async (override?: {
    messageId?: string;
    content: string;
    attachments?: AttachmentMetadata[];
    localPathContexts?: LocalPathContextItem[];
  }) => {
    const externalSubmit = override;
    const isExternalSubmit = externalSubmit !== undefined;
    const statusCommand = isExternalSubmit ? null : parseLeadingStatusCommand(input);
    if (statusCommand) {
      setInput(statusCommand.draft);
      editorRef.current?.replaceTextPreservingSkills(statusCommand.draft);
      return handleStatus();
    }
    const compactCommand = isExternalSubmit ? null : parseLeadingCompactCommand(input);
    if (compactCommand) {
      setInput(compactCommand.draft);
      editorRef.current?.replaceTextPreservingSkills(compactCommand.draft);
      return handleCompact();
    }
    if (isThreadCompacting || isSessionStatusLoading) return false;
    const currentPendingAttachments = externalSubmit ? [] : pendingAttachments;
    const currentAttachedSkills = externalSubmit ? [] : effectiveAttachedSkills;
    const currentLocalPathContexts = externalSubmit
      ? (externalSubmit.localPathContexts ?? [])
      : localPathContexts;
    const planSubmission = getPlanSubmissionState(input, props.runtimeId, props.planMode);
    const planCommand = externalSubmit ? null : planSubmission.command;
    const effectivePlanMode = externalSubmit
      ? props.runtimeId === "kimi" && props.planMode
      : planSubmission.planMode;
    const currentInput = externalSubmit
      ? externalSubmit.content.trim()
      : planSubmission.task.trim();
    const runLocalPathContexts = collectRunLocalPathContexts(
      props.messages,
      currentLocalPathContexts,
      externalSubmit?.messageId,
    );
    const hasCurrentSendableContent = canSubmitComposerContent({
      content: currentInput,
      attachedSkillCount: currentAttachedSkills.length,
      attachmentCount: externalSubmit?.attachments?.length ?? currentPendingAttachments.length,
      localPathContextCount: currentLocalPathContexts.length,
      isPreparingAttachments: isPreparingAttachmentsRef.current,
      isExternalSubmit,
      hasUnavailableAttachments: hasUnavailablePendingAttachments(currentPendingAttachments),
    });
    const canSendCurrent = hasCurrentSendableContent && !!project && isSelectedRuntimeAvailable;

    if (planCommand && planSubmission.attachOnly) {
      props.onPlanModeChange?.(true);
      setInput("");
      editorRef.current?.clear();
      return true;
    }

    if (!canSendCurrent) return false;

    clearSessionStatus();

    // External submits (message edit resend) rewrite history; never let one
    // through while a run is active — it would prune messages and then be
    // rejected by the run coordinator, leaving a stuck placeholder.
    if (isThreadSending && isExternalSubmit) return false;

    if (planCommand) {
      props.onPlanModeChange?.(true);
    }

    // Clear the persisted draft before any state mutation below. Appending
    // the user message flips an empty thread's Composer placement, which
    // remounts this component; the remount may happen before the post-`send`
    // cleanup runs, and a stale draft would resurrect the just-sent text
    // into the new instance's input.
    if (!isExternalSubmit && props.mode !== "association-draft") {
      clearThreadDraft(threadId);
    }

    const validation = validateAttachmentSelection(
      currentPendingAttachments.map((pending) => pending.file),
    );
    if (!validation.ok) {
      setAttachmentError(validation.reason);
      return false;
    }

    if (currentPendingAttachments.some((pending) => !pending.metadata)) {
      setAttachmentError("Some attachments are still being prepared.");
      return false;
    }

    const skillPrefix =
      currentAttachedSkills.length > 0
        ? `${currentAttachedSkills.map(buildSkillReference).join(" ")} `
        : "";
    const messageText = `${skillPrefix}${currentInput}`.trim();
    const attachmentMetadata: AttachmentMetadata[] = externalSubmit
      ? metadataOnly(externalSubmit.attachments ?? [])
      : metadataOnly(currentPendingAttachments.map((pending) => pending.metadata!));

    if (isThreadSending && !isExternalSubmit) {
      enqueueChatMessage(threadId, {
        id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        content: messageText,
        attachments: attachmentMetadata,
        localPathContexts: currentLocalPathContexts,
      });
      setInput("");
      setAttachedSkills([]);
      editorRef.current?.clear();
      setPendingAttachments((prev) => {
        prev.forEach((pending) => {
          if (pending.previewUrl) {
            URL.revokeObjectURL(pending.previewUrl);
          }
        });
        return [];
      });
      setLocalPathContexts([]);
      setAttachmentError(null);
      if (props.mode !== "association-draft") {
        clearThreadDraft(threadId);
      }
      return true;
    }

    // A previous Run's diff capture may still be in flight; wait for it so
    // its Workspace Changes block lands ahead of this turn's messages.
    await pendingWorkspaceDiffCaptureRef.current;

    setAttachmentError(null);

    const appendLocalMessage = (
      role: "user" | "assistant",
      content: string,
      attachments?: AttachmentMetadata[],
      messageLocalPathContexts?: LocalPathContextItem[],
      runStatus?: Message["runStatus"],
    ) => {
      if (props.mode === "association-draft") {
        const now = Date.now();
        return {
          id: `msg-${now}-${Math.random().toString(36).slice(2, 7)}`,
          threadId,
          role,
          type: "text" as const,
          content,
          attachments: attachments ?? [],
          ...(messageLocalPathContexts && messageLocalPathContexts.length > 0
            ? { localPathContexts: messageLocalPathContexts }
            : {}),
          runStatus,
          timestamp: new Date(now).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
          createdAt: new Date(now).toISOString(),
        };
      }
      return appendMessage({
        threadId,
        role,
        content,
        attachments,
        localPathContexts: messageLocalPathContexts,
        runStatus,
      });
    };

    const updateLocalMessageTextPart = (messageId: string, content: string) => {
      if (!content) {
        return;
      }

      updateMessageParts(messageId, {
        kind: "append-text",
        content,
      });
    };

    const updateLocalMessageShellPart = (messageId: string, shell: ChatShellEventPayload) => {
      updateMessageParts(messageId, {
        kind: "upsert-shell",
        shell: {
          type: "shell",
          ...shell,
        },
      });
    };

    const updateLocalMessageReasoningPart = (
      messageId: string,
      reasoning: ChatReasoningEventPayload,
    ) => {
      updateMessageParts(messageId, {
        kind: "upsert-reasoning",
        reasoning: {
          type: "reasoning",
          ...reasoning,
        },
      });
    };

    const updateLocalMessageSubagentTaskPart = (
      messageId: string,
      task: ChatSubagentTaskPayload,
    ) => {
      updateMessageParts(messageId, {
        kind: "upsert-subagent-task",
        task: {
          type: "subagent_task",
          ...task,
        },
      });
    };

    // Files this run reported as written; set by the terminal callbacks
    // before the diff capture reads it.
    const runWrittenFilesRef = { current: [] as string[] };
    const captureWorkspaceDiff = createWorkspaceDiffCapture({
      mode: "thread",
      projectPath: project!.workingDirectory,
      threadId,
      captureBaseline: async (projectPath) => {
        const snapshot = await window.carrent.git.workspaceSnapshot(projectPath);
        return snapshot.state === "ready" ? snapshot.baseRevision : null;
      },
      workspaceDiff: (projectPath, baseRevision) =>
        window.carrent.git.workspaceDiff(projectPath, baseRevision),
      appendWorkspaceDiffMessage,
      getRunWritePaths: () => runWrittenFilesRef.current,
      showToast,
    });

    let userMessageId = externalSubmit?.messageId ?? "";
    let userMessageCreatedAt: string | undefined;
    if (externalSubmit?.messageId) {
      updateMessageAndPruneAfter(externalSubmit.messageId, messageText, currentLocalPathContexts);
    } else {
      const userMessage = appendLocalMessage(
        "user",
        messageText,
        attachmentMetadata,
        currentLocalPathContexts,
      );
      userMessageId = userMessage.id;
      userMessageCreatedAt =
        userMessage.createdAt == null
          ? undefined
          : typeof userMessage.createdAt === "string"
            ? userMessage.createdAt
            : new Date(userMessage.createdAt).toISOString();
    }
    markThreadActivity(threadId);

    const assistantMsg = appendLocalMessage("assistant", "", undefined, undefined, "running");

    flushTypewriterRef.current?.();
    const textRevealer = new StreamingTextRevealer({
      onReveal: (text) => updateLocalMessageTextPart(assistantMsg.id, text),
    });
    flushTypewriterRef.current = () => {
      textRevealer.flush();
      textRevealer.dispose();
      flushTypewriterRef.current = null;
    };

    const transcriptMessages = externalSubmit?.messageId
      ? props.messages.slice(
          0,
          Math.max(
            0,
            props.messages.findIndex((message) => message.id === externalSubmit.messageId),
          ),
        )
      : props.messages;
    const transcript = transcriptMessages
      .filter((m) => m.type !== "changed_files")
      .slice(-6)
      .map((m) => ({
        role: m.role,
        content: getMessageTranscriptContent(m),
      }));

    const requestedRunId = `run-${crypto.randomUUID()}`;
    const runtimeModelIdForSend = getRuntimeModelIdForSend({
      runtimeId: props.runtimeId,
      runtimeModelId: props.runtimeModelId,
    });
    // The title source is the user-visible composer text, not the runtime
    // prompt enriched with Skill references (currentInput is computed before
    // the skill prefix is concatenated into messageText). It is sent as source
    // data only: the Main Process derives the promoted Thread's fallback title
    // and owns the automatic-title trigger.
    const associationDraftTitleSource = props.mode === "association-draft" ? currentInput : "";
    const associationDraftSnapshot =
      props.mode === "association-draft"
        ? buildThreadDraftSnapshot({
            content: currentInput,
            attachedSkills: currentAttachedSkills,
            pendingAttachments: currentPendingAttachments,
            localPathContexts: currentLocalPathContexts,
            composerState: editorStateJson,
          })!
        : null;
    const startedAt = new Date().toISOString();
    const runInput: ComposerAcceptedRunInput = {
      runId: requestedRunId,
      messageId: userMessageId,
      assistantMessageId: assistantMsg.id,
      message: messageText,
      attachments: attachmentMetadata,
      localPathContexts: currentLocalPathContexts,
      startedAt,
      messageCreatedAt: userMessageCreatedAt,
      runtimeId: props.runtimeId,
      runtimeModelId: runtimeModelIdForSend,
      runtimeMode: props.runtimeMode,
      planMode: effectivePlanMode,
    };
    let preparedPersistentRun = false;

    if (props.mode === "association-draft") {
      const promoted = await props.onPromote({
        ...runInput,
        titleSource: associationDraftTitleSource,
        draft: associationDraftSnapshot!,
      });
      if (!promoted) {
        removeMessages([userMessageId, assistantMsg.id]);
        return false;
      }
      preparedPersistentRun = true;
    } else if (props.mode === "thread" && !isExternalSubmit && props.onRunPrepared) {
      preparedPersistentRun = await props.onRunPrepared(runInput);
      if (!preparedPersistentRun) {
        removeMessages([userMessageId, assistantMsg.id]);
        // Run preparation was rejected (the thread is archived or mid-mutation).
        // The input state still holds the text; restore the persisted draft so
        // a remount cannot lose the message either.
        setThreadDraft(
          threadId,
          buildThreadDraftSnapshot({
            content: currentInput,
            attachedSkills: currentAttachedSkills,
            pendingAttachments: currentPendingAttachments,
            localPathContexts: currentLocalPathContexts,
            composerState: editorStateJson,
          })!,
        );
        showToast("This thread is being updated and cannot accept messages right now.", "error");
        return false;
      }
    }

    beginStopGuard(threadId);
    setStopGuarded(true);
    const startedRunId = await send(
      {
        runId: requestedRunId,
        context: {
          kind: "project",
          projectId: props.projectId,
          workingDirectory: project!.workingDirectory,
          workspaceId: props.workspaceId,
        },
        threadId,
        runtimeId: props.runtimeId,
        runtimeModelId: runtimeModelIdForSend,
        runtimeMode: props.runtimeMode,
        planMode: effectivePlanMode,
        transcript,
        message: messageText,
        attachments: attachmentMetadata,
        localPathContexts: runLocalPathContexts,
        historyMode: getChatHistoryMode(!!externalSubmit?.messageId),
      },
      {
        onNotice: (message) => {
          showToast(message, "info");
        },
        onStarted: (runId) => {
          updateRunChecklist(threadId, { kind: "started", runId });
        },
        onDelta: (text) => {
          textRevealer.appendDelta(text);
        },
        onTextSnapshot: (text) => {
          textRevealer.applySnapshot(text);
          updateMessageParts(assistantMsg.id, { kind: "replace-text", content: text });
        },
        onReasoning: (reasoning) => {
          textRevealer.flush();
          updateLocalMessageReasoningPart(assistantMsg.id, reasoning);
        },
        onKimiTimeline: (item) => {
          textRevealer.flush();
          updateMessageParts(assistantMsg.id, { kind: "upsert-kimi-timeline", item });
        },
        onShell: (shell) => {
          textRevealer.flush();
          updateLocalMessageShellPart(assistantMsg.id, shell);
        },
        onSubagentTask: (task) => {
          textRevealer.flush();
          updateLocalMessageSubagentTaskPart(assistantMsg.id, task);
        },
        onChecklist: (checklist, owner) => {
          updateRunChecklist(owner.threadId, {
            kind: "snapshot",
            runId: owner.runId,
            runtimeId: owner.runtimeId,
            entries: checklist.entries,
          });
        },
        onPermissionRequested: (permission) => {
          markThreadActivity(threadId, Date.parse(permission.createdAt));
          textRevealer.flush();
          if (permission.planReview) {
            updateMessageParts(assistantMsg.id, {
              kind: "upsert-plan-review",
              review: {
                type: "plan_review",
                id: `plan-review-${permission.id}`,
                permissionId: permission.id,
                content: permission.planReview.content,
                status: "pending",
                options: permission.options,
              },
            });
          }
        },
        onPermissionResolved: (resolution) => {
          const status =
            resolution.optionId === "plan_revise"
              ? "revision-requested"
              : resolution.optionId === "plan_reject_and_exit"
                ? "rejected"
                : "approved";
          updateMessageParts(assistantMsg.id, {
            kind: "resolve-plan-review",
            permissionId: resolution.permissionId,
            status,
            selectedOptionId: resolution.optionId,
            selectedOptionName: resolution.optionName,
          });
        },
        onPermissionsInterrupted: (permissions) => {
          if (permissions.some((permission) => permission.planReview)) {
            updateMessageParts(assistantMsg.id, { kind: "interrupt-plan-reviews" });
          }
        },
        onQuestionRequested: (question) => {
          textRevealer.flush();
          updateMessageParts(assistantMsg.id, {
            kind: "upsert-question",
            question: {
              type: "question",
              id: `question-${question.id}`,
              questionId: question.id,
              status: "pending",
              questions: question.questions.map(({ header, question: text }) => ({
                header,
                question: text,
              })),
            },
          });
        },
        onQuestionResolved: ({ question, outcome, answers }) => {
          // The final answer comes from the draft store, not the resolution
          // event, so multi-question and Other answers are recorded fully.
          const draftState = getQuestionDraftState(question.id);
          const answerDrafts = answers
            ? getQuestionDraftsFromAnswers(question, answers)
            : draftState?.drafts;
          updateMessageParts(assistantMsg.id, {
            kind: "resolve-question",
            questionId: question.id,
            status: outcome === "answered" ? "answered" : "skipped",
            ...(outcome === "answered" && answerDrafts
              ? { answers: buildQuestionAnswerRecords(question, answerDrafts) }
              : {}),
          });
          clearQuestionDraftState(question.id);
        },
        onQuestionsInterrupted: (questions) => {
          updateMessageParts(assistantMsg.id, { kind: "interrupt-questions" });
          questions.forEach((question) => clearQuestionDraftState(question.id));
        },
        onPlanModeChanged: (enabled) => {
          props.onPlanModeChange?.(enabled);
        },
        onEventApplied: (count) => {
          // Event acknowledgement must not flush pending reveal text; the
          // frame scheduler owns the visible cadence.
          updateMessageRunEventCount(assistantMsg.id, count);
        },
        onComplete: (text, runId, writtenFiles) => {
          runWrittenFilesRef.current = writtenFiles ?? [];
          updateRunChecklist(threadId, { kind: "outcome", runId, outcome: "completed" });
          // A foreground task can never outlive its parent Run; detached
          // tasks keep their state.
          updateMessageParts(assistantMsg.id, { kind: "interrupt-subagent-tasks" });
          updateMessageRunStatus(assistantMsg.id, "completed");
          markThreadActivity(threadId);
          // Remaining buffered text finishes through the adaptive scheduler
          // within a short ceiling; larger backlogs appear immediately. Run
          // completion itself never waits on the reveal.
          textRevealer.finish(text);
          workspaceDiffCapturePendingRef.current = true;
          const completionCapture = captureWorkspaceDiff();
          trackWorkspaceDiffCapture(completionCapture);
          void completionCapture.finally(() => {
            workspaceDiffCapturePendingRef.current = false;
            // The capture appends its message before this rerender asks the
            // queue to send the next Run, preserving the conversation order.
            requestQueueDrain();
          });
        },
        onError: (error, runId, writtenFiles, runtimeSessionRecovery) => {
          runWrittenFilesRef.current = writtenFiles ?? [];
          if (runId) {
            updateRunChecklist(threadId, { kind: "outcome", runId, outcome: "failed" });
          }
          flushTypewriterRef.current?.();
          updateMessageParts(assistantMsg.id, { kind: "interrupt-subagent-tasks" });
          updateMessageParts(assistantMsg.id, {
            kind: "upsert-error",
            error: {
              type: "error",
              id: `error-${assistantMsg.id}`,
              message: error,
              ...(runtimeSessionRecovery
                ? { runtimeSessionRecovery: { ...runtimeSessionRecovery, userMessageId } }
                : {}),
            },
          });
          updateMessageRunStatus(assistantMsg.id, "failed");
          markThreadActivity(threadId);
          trackWorkspaceDiffCapture(captureWorkspaceDiff());
          queueDrainRequestedRef.current = false;
          // A failed run must not swallow a steer request; put it back.
          if (steerItemRef.current) {
            unshiftQueuedChatMessage(threadId, steerItemRef.current);
            steerItemRef.current = null;
          }
        },
        onStop: (runId, writtenFiles) => {
          runWrittenFilesRef.current = writtenFiles ?? [];
          updateRunChecklist(threadId, { kind: "outcome", runId, outcome: "cancelled" });
          flushTypewriterRef.current?.();
          updateMessageParts(assistantMsg.id, { kind: "interrupt-subagent-tasks" });
          updateMessageRunStatus(assistantMsg.id, "cancelled");
          markThreadActivity(threadId);
          if (steerItemRef.current) {
            workspaceDiffCapturePendingRef.current = true;
            const stopCapture = captureWorkspaceDiff();
            trackWorkspaceDiffCapture(stopCapture);
            void stopCapture.finally(() => {
              workspaceDiffCapturePendingRef.current = false;
              requestQueueDrain();
            });
          } else {
            trackWorkspaceDiffCapture(captureWorkspaceDiff());
          }
        },
      },
    );

    if (!startedRunId) {
      if (props.mode === "association-draft") {
        await props.onPromotionRejected(associationDraftSnapshot!);
        removeThreadFromState(props.threadId);
      } else if (props.mode === "thread" && preparedPersistentRun) {
        await props.onRunRejected?.(runInput);
      }
      if (props.mode === "association-draft" || preparedPersistentRun) {
        removeMessages([userMessageId, assistantMsg.id]);
      }
      return false;
    }

    if (props.mode === "association-draft") {
      upsertMessages([assistantMsg]);
      props.onPromoted(props.threadId);
    }

    if (!isExternalSubmit) {
      setInput("");
      setAttachedSkills([]);
      editorRef.current?.clear();
      setPendingAttachments((prev) => {
        prev.forEach((pending) => {
          if (pending.previewUrl) {
            URL.revokeObjectURL(pending.previewUrl);
          }
        });
        return [];
      });
      setLocalPathContexts([]);
      if (props.mode !== "association-draft") {
        clearThreadDraft(threadId);
      }
    }

    if (props.mode === "thread") {
      // Legacy non-draft backfill: a Thread still literally named "New thread"
      // without a manual rename marker receives the deterministic local
      // fallback after a successful submission. The title is derived from the
      // visible composer text (never the skill-enriched runtime prompt) and
      // never invokes model generation. A manual rename — even one renamed
      // back to "New thread" — is protected by the customTitle guard.
      if (thread && thread.title === "New thread" && !thread.customTitle) {
        const title = deriveThreadTitle(currentInput, {
          attachmentName: attachmentMetadata[0]?.name ?? currentLocalPathContexts[0]?.basename,
        });
        if (title !== thread.title) {
          upsertThread(props.projectId, { ...thread, title });
        }
      }
    }

    return true;
  };

  const flushQueuedMessage = (item: QueuedChatMessage) => {
    // Wait for the coordinator's terminal state to be visible before starting
    // the next Run, then restore the item if the new request is rejected.
    setTimeout(() => {
      void handleSend({
        content: item.content,
        attachments: item.attachments,
        localPathContexts: item.localPathContexts,
      }).then((sent) => {
        if (sent) {
          // A queued item can be reintroduced by an older Thread Work
          // broadcast that was already in flight when the item was shifted.
          if (getQueuedMessages(threadId).some((queued) => queued.id === item.id)) {
            removeQueuedChatMessage(threadId, item.id);
          }
        } else {
          unshiftQueuedChatMessage(threadId, item);
        }
      });
    }, 0);
  };

  const handleSteerQueuedMessage = (item: QueuedChatMessage) => {
    const queuedItem = getQueuedMessages(threadId).find((queued) => queued.id === item.id);
    if (!queuedItem) {
      return;
    }

    if (!isThreadSending) {
      removeQueuedChatMessage(threadId, queuedItem.id);
      void handleSend({
        content: queuedItem.content,
        attachments: queuedItem.attachments,
        localPathContexts: queuedItem.localPathContexts,
      }).then((sent) => {
        if (!sent) {
          unshiftQueuedChatMessage(threadId, queuedItem);
        }
      });
      return;
    }
    // Ignore extra steer clicks while a steer-triggered stop is in flight.
    if (steerItemRef.current) {
      return;
    }
    removeQueuedChatMessage(threadId, queuedItem.id);
    steerItemRef.current = queuedItem;
    void stop(threadId);
  };

  useEffect(() => {
    const wasSending = wasSendingForQueueRef.current;
    wasSendingForQueueRef.current = isThreadSending;
    const sharedRunCompleted =
      sharedRun?.status === "completed" && !workspaceDiffCapturePendingRef.current;
    const queueDrainRequested = queueDrainRequestedRef.current;
    // Only the sending→idle transition or an explicit request may admit a
    // drain. sharedRunCompleted alone must not, because the completed run
    // record lingers in the shared state and would re-admit the effect on
    // every render, draining the whole queue at once.
    if (isThreadSending || (!wasSending && !queueDrainRequested)) {
      return;
    }

    const shouldDrain = queueDrainRequested || sharedRunCompleted;
    queueDrainRequestedRef.current = false;
    if (!shouldDrain) {
      return;
    }

    const nextQueued =
      steerItemRef.current ??
      shiftQueuedChatMessage(threadId, { blockedId: editingQueuedIdRef.current });
    steerItemRef.current = null;
    if (nextQueued) {
      flushQueuedMessage(nextQueued);
    }
  }, [
    flushQueuedMessage,
    isThreadSending,
    queueDrainVersion,
    sharedRun?.runId,
    sharedRun?.status,
    threadId,
  ]);

  useEffect(() => {
    // A pending steer belongs to the thread it was created in. When the
    // Composer switches Threads while reusing one instance or unmounts,
    // put the message back into that thread's queue instead of letting it
    // leak into a different thread's run.
    return () => {
      if (steerItemRef.current) {
        unshiftQueuedChatMessage(threadId, steerItemRef.current);
        steerItemRef.current = null;
      }
    };
  }, [threadId]);

  useEffect(() => {
    // Rebuild persisted draft attachments from the Attachment Store bytes.
    // Missing/unreadable attachments are dropped one by one without blocking
    // the text draft or Skill chips from loading.
    const persisted = draftAttachmentsRef.current ?? [];
    let cancelled = false;
    if (persisted.length === 0) {
      draftAttachmentsReadyRef.current = true;
      draftRestoreCompleteRef.current = true;
    } else {
      void (async () => {
        const { attachments: restored, unavailableNames } =
          await restoreDraftAttachments(persisted);
        if (cancelled) {
          restored.forEach((pending) => {
            if (pending.previewUrl) {
              URL.revokeObjectURL(pending.previewUrl);
            }
          });
          return;
        }
        if (restored.length > 0) {
          setPendingAttachments((prev) => [...prev, ...restored]);
        }
        if (unavailableNames.length > 0) {
          setAttachmentError(`文件不可用，请移除或重新添加：${unavailableNames.join(", ")}`);
        }
        draftAttachmentsReadyRef.current = unavailableNames.length === 0;
        draftRestoreCompleteRef.current = true;
      })();
    }

    // Local Path Context restores straight from the draft (plain path data).
    const persistedContexts = draftLocalPathContextsRef.current ?? [];
    if (persistedContexts.length > 0) {
      setLocalPathContexts((prev) => dedupeLocalPathContexts([...prev, ...persistedContexts]));
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Resolve persisted Skill names once the catalog has loaded; names that
    // no longer resolve are silently omitted.
    if (pendingDraftSkillNames === null || skillsLoading) {
      return;
    }
    const restoredSkills = resolveDraftSkillRecords(skills, pendingDraftSkillNames);
    setAttachedSkills(restoredSkills);
    if (!initialDraft?.composerState) {
      editorRef.current?.restoreSkills(restoredSkills);
    }
    setPendingDraftSkillNames(null);
  }, [initialDraft?.composerState, pendingDraftSkillNames, skills, skillsLoading]);

  useEffect(() => {
    const sourceMode = props.mode;
    const sourceThreadId = threadId;
    const sourceAssociationDraftChange = associationDraftChangeRef.current;
    const sourceAssociationDraft = props.mode === "association-draft" ? props.initialDraft : null;
    return () => {
      if (sourceMode === "thread" && compositionActiveRef.current) {
        return;
      }
      const { content, attachedSkills, pendingAttachments, localPathContexts, composerState } =
        compositionBaselineInputRef.current;
      const existingDraft =
        sourceMode === "association-draft"
          ? sourceAssociationDraft
          : getThreadDraft(sourceThreadId);
      const draft = buildThreadDraftSnapshot({
        content,
        attachedSkills,
        pendingAttachments,
        localPathContexts,
        composerState,
        metadataFallback: {
          ...(pendingDraftSkillNamesRef.current !== null
            ? { attachedSkillNames: existingDraft?.attachedSkillNames ?? [] }
            : {}),
          ...(!draftAttachmentsReadyRef.current
            ? { attachments: existingDraft?.attachments ?? [] }
            : {}),
        },
      });
      if (sourceMode === "association-draft") {
        sourceAssociationDraftChange?.(draft);
        return;
      }
      const existing = getThreadDraft(sourceThreadId);
      if (draftsContentEqual(existing, draft)) return;
      if (draft) {
        setThreadDraft(sourceThreadId, draft);
      } else {
        clearThreadDraft(sourceThreadId);
      }
    };
  }, [composerSourceKey, props.mode, threadId]);

  useEffect(() => {
    // Debounce draft persistence; the workspace save path applies its own
    // 500 ms debounce on top before anything hits disk.
    if (!draftRestoreCompleteRef.current || pendingDraftSkillNames !== null) {
      return;
    }
    // Never persist unconfirmed IME text into shared Thread Composer State: it
    // would broadcast candidates to other Carrent Windows and, when echoed
    // back, clear the local composition. Only `mode="thread"` broadcasts and
    // reads back, so only it needs this guard; association drafts persist via
    // onDraftChange with no echo path. The post-composition onSnapshot changes
    // `input`, re-running this effect to persist the final draft.
    if (props.mode === "thread" && isCompositionActive) {
      return;
    }
    const timeout = setTimeout(() => {
      if (props.mode === "thread" && compositionActiveRef.current) {
        return;
      }
      const draft = buildThreadDraftSnapshot({
        content: input,
        attachedSkills,
        pendingAttachments,
        localPathContexts,
        composerState: editorStateJson,
      });
      if (props.mode === "association-draft") {
        associationDraftChangeRef.current?.(draft);
      } else {
        // Skip the write when the store already holds a semantically equal
        // draft. Persistence runs on a 300 ms debounce while applySharedThreadDraft
        // and IME commits churn `input`/`editorStateJson`; without this guard a
        // stale timer can write an older snapshot back into the store, which
        // changes threadDraftSourceKey and echoes through readback into the
        // editor (apply -> persist -> readback -> apply ...), losing the caret.
        const existing = getThreadDraft(threadId);
        if (draftsContentEqual(existing, draft)) {
          lastAppliedThreadDraftSourceKeyRef.current = `${props.mode}:${threadId}:${getThreadDraftSnapshotKey(threadId)}`;
        } else if (draft) {
          setThreadDraft(threadId, draft);
          // Mark the RESULTING store state as consumed: read the snapshot key
          // after the write, otherwise the ref holds the pre-write key and the
          // readback effect re-runs once before its equality guard kicks in.
          lastAppliedThreadDraftSourceKeyRef.current = `${props.mode}:${threadId}:${getThreadDraftSnapshotKey(threadId)}`;
        } else {
          clearThreadDraft(threadId);
          lastAppliedThreadDraftSourceKeyRef.current = `${props.mode}:${threadId}:${getThreadDraftSnapshotKey(threadId)}`;
        }
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [
    threadId,
    input,
    attachedSkills,
    pendingAttachments,
    localPathContexts,
    pendingDraftSkillNames,
    editorStateJson,
    props.mode,
    isCompositionActive,
  ]);

  useEffect(() => {
    if (!props.submitRequest || lastSubmitRequestIdRef.current === props.submitRequest.requestId) {
      return;
    }

    lastSubmitRequestIdRef.current = props.submitRequest.requestId;
    void handleSend({
      messageId: props.submitRequest.messageId,
      content: props.submitRequest.content,
      attachments: props.submitRequest.attachments,
      localPathContexts: props.submitRequest.localPathContexts,
    });
  }, [props.submitRequest?.requestId, props.submitRequest?.content]);

  useEffect(() => {
    const draftRequest = props.draftRequest;
    if (!draftRequest || lastDraftRequestIdRef.current === draftRequest.requestId) {
      return;
    }

    lastDraftRequestIdRef.current = draftRequest.requestId;
    const nextInput = mergeComposerDraftContent(input, draftRequest.content);
    setInput(nextInput);
    if (input.trim()) {
      editorRef.current?.appendText(`\n\n${draftRequest.content}`);
    } else {
      editorRef.current?.replaceTextPreservingSkills(draftRequest.content);
    }
  }, [input, props.draftRequest?.requestId, props.draftRequest?.content]);

  const handleSkillInsert = (skill: SkillRecord) => {
    if (!skillTrigger) {
      return;
    }
    setDismissedSkillInput(null);
    editorRef.current?.insertSkill(skill);
  };

  const handlePlanInsert = () => {
    if (!skillTrigger) {
      return;
    }

    props.onPlanModeChange?.(true);
    setDismissedSkillInput(null);
    editorRef.current?.removeSlashTrigger();
  };

  const selectActiveSlashMenuItem = () => {
    if (showPlanSuggestion && selectedSkillIndex === 0) {
      handlePlanInsert();
    } else if (showCompactSuggestion && selectedSkillIndex === (showPlanSuggestion ? 1 : 0)) {
      void handleCompact(true);
    } else if (
      showStatusSuggestion &&
      selectedSkillIndex === (showPlanSuggestion ? 1 : 0) + (showCompactSuggestion ? 1 : 0)
    ) {
      void handleStatus(true);
    } else {
      const skillIndex = selectedSkillIndex - carrentCommandMenuItemCount;
      const skill = filteredSkills[skillIndex] ?? filteredSkills[0];
      if (skill) handleSkillInsert(skill);
    }
  };

  const handlePermissionResponse = (permission: ChatPermissionRequest, optionId: string) => {
    void respondToPermission({
      runId: permission.runId,
      permissionId: permission.id,
      optionId,
    });
  };
  const handlePlanResponse = async (permission: ChatPermissionRequest, optionId: string) => {
    const result = await respondToPermission({
      runId: permission.runId,
      permissionId: permission.id,
      optionId,
    });
    return result.accepted;
  };
  const handlePlanRevision = async (
    permission: ChatPermissionRequest,
    optionId: string,
    feedback: string,
  ) => {
    const queuedId = `plan-revision-${crypto.randomUUID()}`;
    enqueueChatMessage(threadId, { id: queuedId, content: feedback });
    try {
      const accepted = await handlePlanResponse(permission, optionId);
      if (!accepted) {
        removeQueuedChatMessage(threadId, queuedId);
      }
      return accepted;
    } catch (error) {
      removeQueuedChatMessage(threadId, queuedId);
      throw error;
    }
  };
  const isCenteredPlacement = props.placement === "centered";
  // A pending permission turns the Composer into approval mode: the text
  // input is replaced by the request plus Allow/Deny controls until the user
  // responds. Only the first pending request is shown at a time.
  const activePermission = threadPermissions[0] ?? null;
  const allowOnceOption = activePermission
    ? getPermissionOption(activePermission, "allow_once")
    : null;
  const allowAlwaysOption = activePermission
    ? getPermissionOption(activePermission, "allow_always")
    : null;
  const rejectOnceOption = activePermission
    ? getPermissionOption(activePermission, "reject_once")
    : null;
  const approvalShortcutHint = [
    allowOnceOption ? "y" : null,
    allowAlwaysOption ? "a" : null,
    rejectOnceOption ? "n" : null,
  ]
    .filter(Boolean)
    .join(" / ");

  // Approval-mode keyboard flow: y allows, n denies. Ignored while the user
  // is typing in another field (e.g. editing a queued message).
  useEffect(() => {
    if (!activePermission) {
      return;
    }
    const handleApprovalKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      const kind = getPermissionShortcutKind(event.key);
      if (!kind) {
        return;
      }
      const option = getPermissionOption(activePermission, kind);
      if (option) {
        event.preventDefault();
        void respondToPermission({
          runId: activePermission.runId,
          permissionId: activePermission.id,
          optionId: option.optionId,
        });
      }
    };
    window.addEventListener("keydown", handleApprovalKeyDown);
    return () => window.removeEventListener("keydown", handleApprovalKeyDown);
  }, [activePermission, respondToPermission]);
  const runChecklistPanel = runChecklist ? (
    <RunChecklist
      checklist={runChecklist}
      onExpandedChange={(expanded) => updateRunChecklist(threadId, { kind: "expanded", expanded })}
    />
  ) : null;

  // Plan Review is an explicit decision point. Keep it ahead of structured
  // questions to match the Thread Status precedence for Approval Requests.
  if (pendingPlanReview) {
    return (
      <div className={isCenteredPlacement ? "w-full" : "px-6 pb-5 pt-2"}>
        <div className="relative mx-auto w-full max-w-[56rem]">
          {runChecklistPanel}
          <PlanDecisionPanel
            key={pendingPlanReview.id}
            permission={pendingPlanReview}
            onRespond={(optionId) => handlePlanResponse(pendingPlanReview, optionId)}
            onRequestRevision={(optionId, feedback) =>
              handlePlanRevision(pendingPlanReview, optionId, feedback)
            }
          />
        </div>
      </div>
    );
  }

  // A pending structured question fully replaces the Composer surface (text
  // input, attachments, Skill and Runtime controls, queued-message controls)
  // until it is submitted, skipped, or the Run stops.
  if (threadQuestion) {
    return (
      <div className={isCenteredPlacement ? "w-full" : "px-6 pb-5 pt-2"}>
        <div className="relative mx-auto w-full max-w-[56rem]">
          {runChecklistPanel}
          <QuestionPanel key={threadQuestion.id} question={threadQuestion} />
        </div>
      </div>
    );
  }

  return (
    <div className={isCenteredPlacement ? "w-full" : "px-6 pb-5 pt-2"}>
      <div className="relative mx-auto w-full max-w-[56rem]" aria-busy={isSessionStatusLoading}>
        {runChecklistPanel}
        {sessionStatusSnapshot ? (
          <SessionStatusPanel
            status={sessionStatusSnapshot}
            loading={isSessionStatusLoading}
            onClose={dismissSessionStatus}
          />
        ) : null}
        {showSlashMenu ? (
          <div
            id="composer-slash-menu"
            role="listbox"
            aria-label="Composer commands and Skills"
            className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[0_18px_60px_rgb(0_0_0/0.28)]"
          >
            <div className="max-h-80 overflow-y-auto p-1">
              {showPlanSuggestion ? (
                <button
                  ref={(element) => {
                    if (element) {
                      skillItemRefs.current.set(0, element);
                    } else {
                      skillItemRefs.current.delete(0);
                    }
                  }}
                  id="composer-slash-menu-item-0"
                  role="option"
                  aria-selected={selectedSkillIndex === 0}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handlePlanInsert();
                  }}
                  onMouseEnter={() => setSelectedSkillIndex(0)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition ${
                    selectedSkillIndex === 0 ? "bg-surface-hover" : "hover:bg-surface-raised"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-app-13 font-medium text-fg">
                    Plan mode
                  </span>
                  <span className="shrink-0 text-app-12 text-subtle">Enable plan mode</span>
                </button>
              ) : null}
              {showCompactSuggestion ? (
                <button
                  ref={(element) => {
                    const index = showPlanSuggestion ? 1 : 0;
                    if (element) {
                      skillItemRefs.current.set(index, element);
                    } else {
                      skillItemRefs.current.delete(index);
                    }
                  }}
                  id={`composer-slash-menu-item-${showPlanSuggestion ? 1 : 0}`}
                  role="option"
                  aria-selected={selectedSkillIndex === (showPlanSuggestion ? 1 : 0)}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    void handleCompact(true);
                  }}
                  onMouseEnter={() => setSelectedSkillIndex(showPlanSuggestion ? 1 : 0)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition ${
                    selectedSkillIndex === (showPlanSuggestion ? 1 : 0)
                      ? "bg-surface-hover"
                      : "hover:bg-surface-raised"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-app-13 font-medium text-fg">
                    Compact
                  </span>
                  <span className="shrink-0 text-app-12 text-subtle">
                    Compress this thread&apos;s context ({Math.round(kimiStatus?.percentage ?? 0)}%
                    used)
                  </span>
                </button>
              ) : null}
              {showStatusSuggestion ? (
                <button
                  ref={(element) => {
                    const index = (showPlanSuggestion ? 1 : 0) + (showCompactSuggestion ? 1 : 0);
                    if (element) {
                      skillItemRefs.current.set(index, element);
                    } else {
                      skillItemRefs.current.delete(index);
                    }
                  }}
                  id={`composer-slash-menu-item-${
                    (showPlanSuggestion ? 1 : 0) + (showCompactSuggestion ? 1 : 0)
                  }`}
                  role="option"
                  aria-selected={
                    selectedSkillIndex ===
                    (showPlanSuggestion ? 1 : 0) + (showCompactSuggestion ? 1 : 0)
                  }
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    void handleStatus(true);
                  }}
                  onMouseEnter={() =>
                    setSelectedSkillIndex(
                      (showPlanSuggestion ? 1 : 0) + (showCompactSuggestion ? 1 : 0),
                    )
                  }
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition ${
                    selectedSkillIndex ===
                    (showPlanSuggestion ? 1 : 0) + (showCompactSuggestion ? 1 : 0)
                      ? "bg-surface-hover"
                      : "hover:bg-surface-raised"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-app-13 font-medium text-fg">
                    Status
                  </span>
                  <span className="shrink-0 text-app-12 text-subtle">
                    Inspect this Runtime Session
                  </span>
                </button>
              ) : null}
              {showSkills ? (
                <div className="px-3 pb-1 pt-2 text-app-12 font-medium text-muted">Skills</div>
              ) : null}
              {showSkills && skillsLoading ? (
                <div className="px-3 py-2 text-app-12 text-subtle">Loading skills...</div>
              ) : showSkills && skillsError ? (
                <div className="px-3 py-2 text-app-12 text-danger">{skillsError}</div>
              ) : showSkills && filteredSkills.length > 0 ? (
                filteredSkills.map((skill, index) => {
                  const menuIndex = index + carrentCommandMenuItemCount;
                  const isSelected = menuIndex === selectedSkillIndex;

                  return (
                    <button
                      key={skill.path}
                      ref={(element) => {
                        if (element) {
                          skillItemRefs.current.set(menuIndex, element);
                        } else {
                          skillItemRefs.current.delete(menuIndex);
                        }
                      }}
                      id={`composer-slash-menu-item-${menuIndex}`}
                      role="option"
                      aria-selected={isSelected}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSkillInsert(skill);
                      }}
                      onMouseEnter={() => setSelectedSkillIndex(menuIndex)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition ${
                        isSelected ? "bg-surface-hover" : "hover:bg-surface-raised"
                      }`}
                    >
                      <Box className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-app-13 font-medium text-fg">
                          {formatSkillLabel(skill.name)}
                        </span>
                        <span className="ml-2 text-app-12 text-subtle">{skill.description}</span>
                      </span>
                      <span className="shrink-0 text-app-10 uppercase text-subtle">
                        {skill.scope === "project" ? "project" : skill.source}
                      </span>
                    </button>
                  );
                })
              ) : !showPlanSuggestion && !showCompactSuggestion && !showStatusSuggestion ? (
                <div className="px-3 py-2 text-app-12 text-subtle">No skills found.</div>
              ) : null}
            </div>
          </div>
        ) : null}
        {queuedMessages.length > 0 ? (
          <div className="relative mx-4 -mb-3 rounded-t-xl border border-border bg-bg/45 px-3 pt-1 pb-4">
            <div className="max-h-32 divide-y divide-border/60 overflow-y-auto">
              {queuedMessages.map((item) => {
                const isEditingQueued = editingQueuedId === item.id;
                return (
                  <div key={item.id} className="group flex items-center gap-x-2 py-1.5">
                    <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-subtle" />
                    {isEditingQueued ? (
                      <input
                        autoFocus
                        value={editingQueuedText}
                        onChange={(event) => setEditingQueuedText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitQueuedEdit();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelQueuedEdit();
                          }
                        }}
                        onBlur={commitQueuedEdit}
                        aria-label="Edit queued message"
                        className="h-6 min-w-0 flex-1 rounded-sm bg-transparent text-app-13 text-fg outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-app-13 text-muted transition group-hover:text-fg">
                        {item.content}
                      </span>
                    )}
                    {item.attachments && item.attachments.length > 0 ? (
                      <span className="flex shrink-0 items-center gap-1 text-app-11 text-subtle">
                        <Paperclip className="h-3 w-3" />
                        {item.attachments.length}
                      </span>
                    ) : null}
                    {item.requiresConfirmation ? (
                      <span
                        aria-label="Restored queued message"
                        className="shrink-0 text-app-11 text-subtle"
                      >
                        Restored
                      </span>
                    ) : null}
                    {isEditingQueued ? (
                      <div className="ml-auto flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={commitQueuedEdit}
                          aria-label="Save queued message"
                          title="Save"
                          className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={cancelQueuedEdit}
                          aria-label="Cancel editing queued message"
                          title="Cancel"
                          className="flex h-6 w-6 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="ml-auto flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => handleSteerQueuedMessage(item)}
                          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-app-11 text-muted transition hover:bg-surface-hover hover:text-fg"
                          title={
                            isThreadSending ? "Stop the current run and send this now" : "Send now"
                          }
                        >
                          <Zap className="h-3 w-3" />
                          {isThreadSending ? "Steer" : "Send"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            editingQueuedIdRef.current = item.id;
                            setEditingQueuedId(item.id);
                            setEditingQueuedText(item.content);
                          }}
                          aria-label="Edit queued message"
                          title="Edit"
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeQueuedChatMessage(threadId, item.id)}
                          aria-label="Delete queued message"
                          title="Delete"
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <div
          data-composer-surface
          className={`relative z-10 rounded-xl border bg-surface-raised/90 p-3 transition-colors duration-200 ${
            activePermission
              ? "border-warning/40"
              : "border-border focus-within:border-border-strong"
          }`}
        >
          {localPathContexts.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {localPathContexts.map((item) => (
                <div
                  key={`${item.kind}:${item.path}`}
                  data-local-path-context-card
                  title={item.path}
                  className="group flex h-14 min-w-0 max-w-full basis-52 items-center rounded-lg border border-border-strong bg-bg/45"
                >
                  <button
                    type="button"
                    onClick={() => void handleRevealLocalPathContext(item.path, item.basename)}
                    aria-label={`Reveal ${item.basename} in Finder`}
                    className="flex h-full min-w-0 flex-1 items-center gap-2 px-2.5 text-left outline-none transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
                  >
                    {item.kind === "directory" ? (
                      <Folder className="h-4 w-4 shrink-0 text-muted" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-app-12 leading-5 text-fg">
                        {item.basename}
                      </span>
                      <span className="block text-app-11 leading-4 text-subtle">
                        {item.kind === "directory" ? "Folder" : "File"}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveLocalPathContext(item.path, item.kind)}
                    aria-label={`Remove ${item.basename}`}
                    title={`Remove ${item.basename}`}
                    className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted outline-none transition hover:bg-surface-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-fg/25"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {pendingAttachments.map((attachment) => {
                if (!attachment.previewUrl) {
                  const FileIcon =
                    FILE_ATTACHMENT_ICONS[fileAttachmentIconKind(attachment.file.name)];
                  const displaySize = attachment.metadata?.size ?? attachment.file.size;
                  return (
                    <div
                      key={attachment.id}
                      title={attachment.file.name}
                      className="group relative flex h-16 w-48 shrink-0 items-center gap-2 rounded-lg border border-border-strong px-2.5"
                    >
                      <FileIcon className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-app-12 leading-5 text-fg">
                          {attachment.file.name}
                        </div>
                        <div className="text-app-11 leading-4 text-subtle">
                          {attachment.unavailable
                            ? "文件不可用"
                            : formatAttachmentSize(displaySize)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRemovePendingAttachment(attachment.id);
                        }}
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-bg/80 text-muted transition hover:text-fg"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={attachment.id}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setLightboxAttachmentIndex(
                        pendingImageAttachments(pendingAttachments).indexOf(attachment),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setLightboxAttachmentIndex(
                          pendingImageAttachments(pendingAttachments).indexOf(attachment),
                        );
                      }
                    }}
                    className="group relative shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border-strong"
                  >
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file.name}
                      className="h-16 w-16 object-cover"
                    />
                    <span className="sr-only">{attachment.file.name}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemovePendingAttachment(attachment.id);
                      }}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-bg/80 text-muted transition hover:text-fg"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {localMcpSkillsDisabled ? (
            <div className="mb-2 rounded-lg border border-border bg-bg/45 px-3 py-2 text-app-12 text-subtle">
              Local MCP Server is off. Skills are unavailable for this Kimi message.
            </div>
          ) : null}
          {runtimeSetupRequired ? (
            <div className="mb-3 rounded-lg border border-border-strong bg-bg/55 px-3 py-2">
              <div className="flex min-h-7 items-center gap-2.5">
                <CircleAlert className="h-4 w-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-app-12 font-medium leading-5 text-fg">
                    {runtimeNameMap[props.runtimeId]} setup required
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => navigate("/settings?tab=general")}
                    className="flex min-h-7 items-center rounded-md px-2 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
                  >
                    Setup
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshRuntimes()}
                    disabled={runtimesLoading}
                    className="flex min-h-7 items-center gap-1.5 rounded-md px-2 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-40"
                  >
                    <RefreshCw className={`h-3 w-3 ${runtimesLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {activePermission ? (
            <div className="flex min-h-20 flex-col justify-center gap-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <div className="text-app-13 font-medium leading-5 text-fg">
                    {activePermission.title}
                  </div>
                  <div className="mt-0.5 break-words text-app-12 leading-5 text-subtle">
                    {getPermissionDetail(activePermission)}
                  </div>
                </div>
                {threadPermissions.length > 1 ? (
                  <span className="shrink-0 text-app-11 text-subtle">
                    +{threadPermissions.length - 1} more
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {allowOnceOption ? (
                  <button
                    type="button"
                    onClick={() =>
                      handlePermissionResponse(activePermission, allowOnceOption.optionId)
                    }
                    aria-label={`Approve: ${activePermission.title}`}
                    className="flex h-8 items-center gap-1.5 rounded-full bg-fg px-3.5 text-app-12 font-medium text-bg transition hover:opacity-90 active:scale-95"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {allowOnceOption.name || "Allow"}
                  </button>
                ) : null}
                {allowAlwaysOption ? (
                  <button
                    type="button"
                    onClick={() =>
                      handlePermissionResponse(activePermission, allowAlwaysOption.optionId)
                    }
                    aria-label={`Approve for this session: ${activePermission.title}`}
                    className="flex h-8 items-center gap-1.5 rounded-full border border-warning/40 px-3.5 text-app-12 text-warning transition hover:bg-warning/10 active:scale-95"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {allowAlwaysOption.name || "Allow for session"}
                  </button>
                ) : null}
                {rejectOnceOption ? (
                  <button
                    type="button"
                    onClick={() =>
                      handlePermissionResponse(activePermission, rejectOnceOption.optionId)
                    }
                    aria-label={`Deny: ${activePermission.title}`}
                    className="flex h-8 items-center gap-1.5 rounded-full border border-border-strong px-3.5 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg active:scale-95"
                  >
                    <X className="h-3.5 w-3.5" />
                    {rejectOnceOption.name || "Deny"}
                  </button>
                ) : null}
                <span className="ml-1 text-app-11 text-subtle">{approvalShortcutHint}</span>
              </div>
            </div>
          ) : (
            <ComposerEditor
              ref={editorRef}
              initialContent={input}
              initialSkills={attachedSkills}
              initialSerializedState={editorStateJson}
              skills={skills}
              menuOpen={showSlashMenu}
              menuItemCount={slashMenuItemCount}
              controlsId="composer-slash-menu"
              activeDescendantId={
                showSlashMenu && slashMenuItemCount > 0
                  ? `composer-slash-menu-item-${selectedSkillIndex}`
                  : undefined
              }
              skillsDisabled={localMcpSkillsDisabled}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onSnapshot={(snapshot) => {
                setInput(snapshot.content);
                setAttachedSkills(snapshot.skills);
                setEditorStateJson(snapshot.serializedState);
                setDismissedSkillInput(null);
                // Only `mode="thread"` subscribes to shared Thread Composer
                // State, so only it participates in composition coordination.
                // `association-draft` keeps its input and persistence path
                // untouched.
                if (props.mode !== "thread") return;
                // While IME composition is active, ignore shared-draft updates:
                // rewriting the editor would clear the candidate text. The only
                // snapshot worth resolving is the post-composition one, signaled
                // by compositionend having fired (compositionEndedRef).
                if (compositionActiveRef.current && !compositionEndedRef.current) return;
                if (compositionDraftBaseRef.current !== undefined) {
                  const base = compositionDraftBaseRef.current;
                  const currentDraft = buildThreadDraftSnapshot({
                    content: snapshot.content,
                    attachedSkills: snapshot.skills,
                    pendingAttachments,
                    localPathContexts,
                    composerState: snapshot.serializedState,
                  });
                  const localChanged = JSON.stringify(currentDraft) !== JSON.stringify(base);
                  const pendingShared = pendingSharedDraftRef.current;
                  resetCompositionState();
                  // The local final draft wins: keep the committed text and let
                  // the debounced persistence save it. Only when the composition
                  // was cancelled without changing the local draft do we apply
                  // the last shared draft seen during composition.
                  if (!localChanged && pendingShared !== undefined) {
                    applySharedThreadDraft(pendingShared);
                  }
                }
              }}
              onTriggerChange={setSkillTrigger}
              onMenuMove={(direction) => {
                setSelectedSkillIndex((index) =>
                  slashMenuItemCount === 0
                    ? 0
                    : (index + direction + slashMenuItemCount) % slashMenuItemCount,
                );
              }}
              onMenuSelect={selectActiveSlashMenuItem}
              onMenuDismiss={() => setDismissedSkillInput(input)}
              onSubmit={() => {
                if (
                  canSend ||
                  parseLeadingCompactCommand(input) ||
                  parseLeadingStatusCommand(input)
                ) {
                  void handleSend();
                }
              }}
              onPasteFiles={(files) => void handleAddFiles(files)}
              resolvePastedContent={resolvePastedComposerContent}
            />
          )}
          {isThreadCompacting ? (
            <div className="mt-2 text-app-12 text-subtle" role="status">
              Compacting
            </div>
          ) : null}
          {threadActionError ? (
            <div className="mt-2 text-app-12 text-danger" role="alert">
              {threadActionError}
            </div>
          ) : null}
          {isSessionStatusLoading ? (
            <div className="mt-2 text-app-12 text-subtle" role="status">
              Loading session status...
            </div>
          ) : null}
          {sessionStatusError ? (
            <div className="mt-2 text-app-12 text-danger" role="alert">
              {sessionStatusError}
            </div>
          ) : null}
          {attachmentError && <div className="mt-2 text-app-12 text-danger">{attachmentError}</div>}
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {props.onRuntimeIdChange ? (
                <div ref={runtimePickerRef} className="relative">
                  <button
                    onClick={() => {
                      if (!isThreadSending && !isThreadCompacting) {
                        setShowRuntimePicker((v) => {
                          if (v) {
                            closeRuntimePicker();
                          } else {
                            setIsPointerOverRuntimeMenu(true);
                          }
                          return !v;
                        });
                      }
                    }}
                    disabled={isThreadSending || isThreadCompacting}
                    className={`flex max-w-[14rem] items-center gap-1.5 rounded-md px-2 py-1 text-app-12 transition disabled:opacity-40 ${
                      showRuntimePicker ? "bg-surface-hover text-fg" : "text-muted hover:text-fg"
                    }`}
                    title={
                      isThreadSending || isThreadCompacting
                        ? "Locked while the Thread is busy"
                        : "Runtime"
                    }
                  >
                    <RuntimeIcon
                      name={
                        isSelectedRuntimeAvailable ? runtimeNameMap[props.runtimeId] : "Runtime"
                      }
                      size="xs"
                    />
                    <span className="min-w-0 truncate">{runtimeButtonLabel}</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {showRuntimePicker && (
                    <div
                      className="absolute bottom-full left-0 mb-1.5 max-h-80 w-64 overflow-y-auto rounded-lg border border-border-strong bg-surface py-1 shadow-xl"
                      onMouseEnter={() => setIsPointerOverRuntimeMenu(true)}
                      onMouseLeave={() => {
                        setIsPointerOverRuntimeMenu(false);
                      }}
                    >
                      {runtimeOptions.length > 0 ? (
                        runtimeOptions.map((runtime) => {
                          const supportsModelCascade =
                            runtime.id !== "kimi" &&
                            supportsRuntimeModelSelection(runtime.id) &&
                            props.onRuntimeModelIdChange;

                          return (
                            <div key={runtime.id}>
                              {!(runtime.id === "kimi" && props.onRuntimeModelIdChange) ? (
                                <button
                                  onMouseEnter={(event) => {
                                    if (!supportsModelCascade) {
                                      setCascadingRuntimeId(null);
                                      setCascadingAnchorRect(null);
                                      setCascadingPanelPosition(null);
                                      return;
                                    }

                                    const rect = event.currentTarget.getBoundingClientRect();
                                    setCascadingRuntimeId(runtime.id);
                                    setCascadingAnchorRect({
                                      left: rect.left,
                                      top: rect.top,
                                      right: rect.right,
                                      bottom: rect.bottom,
                                      width: rect.width,
                                      height: rect.height,
                                    });
                                    setIsPointerOverCascadingPanel(false);
                                  }}
                                  onClick={() => {
                                    props.onRuntimeIdChange!(runtime.id);
                                    if (
                                      !supportsRuntimeModelSelection(runtime.id) ||
                                      !props.onRuntimeModelIdChange
                                    ) {
                                      props.onRuntimeModelIdChange?.(undefined);
                                      closeRuntimePicker();
                                      return;
                                    }

                                    closeRuntimePicker();
                                  }}
                                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-12 transition hover:bg-surface-raised ${
                                    runtime.id === props.runtimeId ? "text-fg" : "text-muted"
                                  }`}
                                >
                                  <RuntimeIcon name={runtime.name} size="xs" />
                                  <span className="min-w-0 flex-1">
                                    {getComposerRuntimeLabel(runtime)}
                                  </span>
                                  {supportsModelCascade ? (
                                    <ChevronDown className="ml-auto h-3 w-3 shrink-0" />
                                  ) : null}
                                </button>
                              ) : null}
                              {runtime.id === "kimi" && props.onRuntimeModelIdChange ? (
                                <div className="mx-2 mb-1 pt-1">
                                  <div className="px-2 pb-1 pt-1 text-app-11 font-semibold uppercase tracking-wider text-muted">
                                    Kimi Code models
                                  </div>
                                  {kimiMenuLoading ? (
                                    <div className="px-2 py-2 text-app-12 leading-5 text-subtle">
                                      Loading models...
                                    </div>
                                  ) : kimiMenuModels.length > 0 ? (
                                    kimiMenuModels.map((model) => {
                                      const selectedModelId =
                                        props.runtimeId === "kimi"
                                          ? (props.runtimeModelId ??
                                            kimiMenuDefaultModelId ??
                                            kimiMenuModels[0]?.id)
                                          : undefined;
                                      const isSelected = model.id === selectedModelId;

                                      return (
                                        <button
                                          key={model.id}
                                          onClick={() => {
                                            props.onRuntimeIdChange?.("kimi");
                                            props.onRuntimeModelIdChange?.(model.id);
                                            closeRuntimePicker();
                                          }}
                                          className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-app-12 transition hover:bg-surface-raised ${
                                            isSelected ? "text-fg" : "text-muted"
                                          }`}
                                        >
                                          <span className="min-w-0 truncate">
                                            {formatKimiModelLabel(model.name)}
                                          </span>
                                          {isSelected ? (
                                            <Check className="h-3.5 w-3.5 shrink-0 text-fg" />
                                          ) : null}
                                        </button>
                                      );
                                    })
                                  ) : (
                                    <div className="px-2 py-2 text-app-12 leading-5 text-subtle">
                                      No models found.
                                    </div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <div className="px-3 py-2 text-app-12 leading-5 text-subtle">
                          No runtime available
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : null}
              {showCascadingPanel && typeof document !== "undefined"
                ? createPortal(
                    <div
                      ref={cascadingPanelRef}
                      onMouseEnter={() => {
                        setIsPointerOverCascadingPanel(true);
                        if (runtimeCloseTimerRef.current) {
                          clearTimeout(runtimeCloseTimerRef.current);
                          runtimeCloseTimerRef.current = null;
                        }
                      }}
                      onMouseLeave={() => {
                        setIsPointerOverCascadingPanel(false);
                      }}
                      className={`fixed z-50 rounded-lg border border-border-strong bg-surface py-1 shadow-xl transition-[opacity,transform] duration-150 ease-out ${cascadingPanelTransitionClass}`}
                      style={{
                        left: `${cascadingPanelPosition?.left ?? 0}px`,
                        top: `${cascadingPanelPosition?.top ?? 0}px`,
                        width: `${cascadingPanelPosition?.width ?? CASCADING_PANEL_DEFAULT_WIDTH}px`,
                        maxHeight: `calc(100vh - ${CASCADING_PANEL_PADDING * 2}px)`,
                        visibility: cascadingPanelPosition ? "visible" : "hidden",
                        transformOrigin:
                          cascadingPanelPosition?.side === "left"
                            ? "top right"
                            : cascadingPanelPosition?.side === "right"
                              ? "top left"
                              : "top center",
                      }}
                    >
                      <div className="px-3 pb-1.5 pt-1.5">
                        <div className="text-app-11 font-semibold uppercase tracking-wider text-muted">
                          {cascadingRuntimeId
                            ? `${runtimeNameMap[cascadingRuntimeId]} models`
                            : "models"}
                        </div>
                      </div>
                      <div className="max-h-[calc(100vh-24px)] overflow-y-auto px-1 pb-1">
                        {props.runtimeModelId &&
                        !cascadingModels.some((model) => model.id === props.runtimeModelId) ? (
                          <button
                            onClick={() => {
                              props.onRuntimeIdChange?.(cascadingRuntimeId ?? "kimi");
                              props.onRuntimeModelIdChange?.(props.runtimeModelId);
                              closeRuntimePicker();
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-app-12 text-fg transition hover:bg-surface-raised"
                          >
                            <span className="min-w-0 truncate">{props.runtimeModelId}</span>
                            <Check className="h-3.5 w-3.5 shrink-0 text-fg" />
                          </button>
                        ) : null}

                        {cascadingLoading ? (
                          <div className="px-3 py-2 text-app-12 leading-5 text-subtle">
                            Loading models...
                          </div>
                        ) : cascadingModels.length > 0 ? (
                          cascadingModels.map((model) => {
                            const label = model.provider
                              ? `${model.provider} / ${model.name}`
                              : model.name;
                            const isSelected = model.id === props.runtimeModelId;

                            return (
                              <button
                                key={model.id}
                                onClick={() => {
                                  props.onRuntimeIdChange?.(cascadingRuntimeId ?? "kimi");
                                  props.onRuntimeModelIdChange?.(model.id);
                                  closeRuntimePicker();
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-app-12 transition hover:bg-surface-raised ${
                                  isSelected ? "text-fg" : "text-muted"
                                }`}
                              >
                                <span className="min-w-0 truncate">{label}</span>
                                {isSelected ? (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-fg" />
                                ) : null}
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-3 py-2 text-app-12 leading-5 text-subtle">
                            No models found.
                          </div>
                        )}
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
              {props.onRuntimeModeChange ? (
                <div ref={modePickerRef} className="relative">
                  <button
                    onClick={() => {
                      if (!isThreadSending && !isThreadCompacting) {
                        setShowModePicker((v) => !v);
                      }
                    }}
                    disabled={isThreadSending || isThreadCompacting}
                    className={`flex max-w-[12rem] items-center gap-1.5 rounded-md px-2 py-1 text-app-12 transition disabled:opacity-40 ${
                      showModePicker ? "bg-surface-hover text-fg" : "text-muted hover:text-fg"
                    }`}
                    title={
                      isThreadSending ? "Locked while runtime is running" : "Runtime permissions"
                    }
                  >
                    <RuntimeModeIcon
                      mode={props.runtimeMode ?? DEFAULT_RUNTIME_MODE}
                      className="h-3 w-3"
                    />
                    <span className="min-w-0 truncate">
                      {getRuntimeModeLabel(
                        props.runtimeMode ?? DEFAULT_RUNTIME_MODE,
                        props.runtimeId,
                      )}
                    </span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {showModePicker && (
                    <div className="absolute bottom-full left-0 mb-1.5 w-72 rounded-lg border border-border-strong bg-surface py-1 shadow-xl">
                      {(
                        ["approval-required", "auto-accept-edits", "full-access"] as RuntimeMode[]
                      ).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => {
                            props.onRuntimeModeChange!(mode);
                            setShowModePicker(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-app-12 transition hover:bg-surface-raised ${
                            mode === props.runtimeMode ? "text-fg" : "text-muted"
                          }`}
                        >
                          <RuntimeModeIcon mode={mode} className="h-3 w-3" />
                          <span>
                            {getRuntimeModeLabel(mode, props.runtimeId)}
                            {mode === "full-access" ? " (danger)" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              {props.runtimeId === "kimi" && props.planMode && props.onPlanModeChange ? (
                <span className="flex items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1 text-app-12 text-fg">
                  <ListChecks className="h-3.5 w-3.5" />
                  <span>Plan</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!isThreadSending && !isThreadCompacting) {
                        props.onPlanModeChange?.(false);
                      }
                    }}
                    disabled={isThreadSending || isThreadCompacting}
                    className="flex h-4 w-4 items-center justify-center rounded-full text-muted transition hover:bg-surface-raised hover:text-fg disabled:opacity-40"
                    title={
                      isThreadSending ? "Locked while runtime is running" : "Disable plan mode"
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                disabled={isPreparingAttachments}
                className="hidden"
                onChange={(event) => {
                  void handleAddFiles(event.target.files);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isThreadSending || isPreparingAttachments}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-app-12 text-muted transition hover:text-fg disabled:opacity-40"
                title="Attach files"
                aria-label="Attach files"
              >
                <Paperclip className="h-3.5 w-3.5" />
                <span>Attach</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {props.runtimeId === "kimi" ? (
                <ContextUsageIndicator
                  key={threadId}
                  status={kimiStatus}
                  loadState={kimiStatusLoadState}
                  onRefresh={refreshKimiStatus}
                />
              ) : null}
              {isThreadSending ? (
                <button
                  aria-label="Stop run"
                  onClick={() => void stop(threadId)}
                  disabled={stopGuarded}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition hover:opacity-90 active:scale-95 disabled:opacity-40"
                >
                  <div className="h-3 w-3 rounded-[2px] bg-current" />
                </button>
              ) : (
                <button
                  aria-label="Send message"
                  onClick={() => void handleSend()}
                  disabled={!canSend || isThreadSending}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-90 active:scale-95 disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {lightboxAttachmentIndex !== null && (
            <ImageAttachmentLightbox
              items={pendingImageAttachments(pendingAttachments).map(
                (attachment): LightboxItem => ({
                  id: attachment.id,
                  name: attachment.file.name,
                  url: attachment.previewUrl!,
                }),
              )}
              initialIndex={lightboxAttachmentIndex}
              onClose={() => setLightboxAttachmentIndex(null)}
            />
          )}
        </div>

        <div className="mt-2 flex justify-end">
          {project?.workingDirectory ? (
            <div ref={branchPickerRef} className="relative">
              <button
                onClick={() => {
                  if (!isThreadSending) {
                    setShowBranchPicker((v) => !v);
                  }
                }}
                disabled={isThreadSending || gitLoading}
                className={`flex max-w-[12rem] items-center gap-1.5 rounded-md px-2 py-1 text-app-12 transition disabled:opacity-40 ${
                  showBranchPicker ? "bg-surface-hover text-fg" : "text-muted hover:text-fg"
                }`}
                title={gitLoading ? "Loading branches" : "Git branch"}
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span className="min-w-0 truncate">
                  {gitLoading ? "Loading..." : (currentBranch ?? "No branch")}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {showBranchPicker && (
                <div className="absolute bottom-full right-0 mb-1.5 flex max-h-[24rem] w-72 flex-col rounded-lg border border-border-strong bg-surface shadow-xl">
                  <div className="px-2 pb-1.5 pt-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                      <input
                        type="text"
                        value={branchSearchQuery}
                        onChange={(e) => setBranchSearchQuery(e.target.value)}
                        placeholder="Search branches"
                        className="w-full rounded-md border border-border-strong bg-bg py-1 pl-7 pr-2 text-app-12 text-fg placeholder:text-subtle outline-none focus:border-fg/20"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="min-h-0 overflow-y-auto px-1 pb-1">
                    {visibleLocalBranches.length > 0 ? (
                      <div className="px-2 pb-1 pt-1 text-app-10 font-medium uppercase tracking-[0.08em] text-subtle">
                        Branches
                      </div>
                    ) : null}
                    {visibleLocalBranches.map((branch) => {
                      const isCurrent = branch === currentBranch;
                      return (
                        <button
                          key={branch}
                          onClick={() => {
                            if (!isCurrent && project?.workingDirectory) {
                              void (async () => {
                                try {
                                  const git = getGitBridge(window.carrent);
                                  const info = normalizeGitBranchInfo(
                                    await git.checkout(project.workingDirectory, branch),
                                  );
                                  setCurrentBranch(info.current);
                                  setGitBranches(info.branches);
                                  setGitBranchWorktrees(info.branchWorktrees);
                                } catch (error) {
                                  showToast(getGitToastMessage(error), "error");
                                }
                              })();
                            }
                            setShowBranchPicker(false);
                            setBranchSearchQuery("");
                            setNewBranchName(CREATE_BRANCH_DEFAULT_NAME);
                            setShowCreateBranchInput(false);
                          }}
                          className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-app-12 transition hover:bg-surface-raised ${
                            isCurrent ? "text-fg" : "text-muted"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{branch}</span>
                          </span>
                          {isCurrent ? <Check className="h-3.5 w-3.5 shrink-0 text-fg" /> : null}
                        </button>
                      );
                    })}
                    {visibleWorktreeBranches.length > 0 ? (
                      <div className="px-2 pb-1 pt-2 text-app-10 font-medium uppercase tracking-[0.08em] text-subtle">
                        Worktrees
                      </div>
                    ) : null}
                    {visibleWorktreeBranches.map((branch) => {
                      const branchWorktree = gitBranchWorktrees.find(
                        (worktree) => worktree.branch === branch,
                      );
                      return (
                        <button
                          key={branch}
                          disabled
                          title={
                            branchWorktree ? `Checked out at ${branchWorktree.path}` : undefined
                          }
                          className="flex w-full cursor-not-allowed items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-app-12 text-subtle transition disabled:hover:bg-transparent"
                        >
                          <span className="min-w-0">
                            <span className="block truncate">{branch}</span>
                            <span className="block truncate text-app-10 text-subtle">
                              {branchWorktree?.path ?? "Checked out in another worktree"}
                            </span>
                          </span>
                          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-app-10 text-subtle">
                            Worktree
                          </span>
                        </button>
                      );
                    })}
                    {visibleLocalBranches.length === 0 && visibleWorktreeBranches.length === 0 ? (
                      <div className="px-3 py-2 text-app-12 text-subtle">No branches found</div>
                    ) : null}
                  </div>
                  <div className="border-t border-border px-2 pb-2 pt-2">
                    {showCreateBranchInput ? (
                      <form onSubmit={handleCreateBranch} className="flex gap-1.5">
                        <input
                          type="text"
                          value={newBranchName}
                          onChange={(event) => setNewBranchName(event.target.value)}
                          placeholder="Branch name"
                          className="min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-2 py-1 text-app-12 text-fg placeholder:text-subtle outline-none focus:border-fg/20"
                          autoFocus
                        />
                        <button
                          type="submit"
                          disabled={creatingBranch || !newBranchName.trim()}
                          className="rounded-md bg-fg px-2.5 py-1 text-app-12 font-medium text-bg transition hover:bg-fg/90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Create
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateBranchInput(true);
                          setNewBranchName(CREATE_BRANCH_DEFAULT_NAME);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-app-12 text-muted transition hover:bg-surface-raised hover:text-fg"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Create branch</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
