import {
  AlertTriangle,
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  Image,
  Lock,
  Pencil,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
} from "react";
import { createPortal } from "react-dom";

import type { ImageAttachmentMetadata, KimiSessionStatus } from "../../../shared/chat";
import {
  metadataOnly,
  pendingAttachmentFromFile,
  validateImageAttachments,
  type PendingAttachment,
} from "../../lib/imageAttachments";
import { deriveThreadTitle } from "../../lib/threadTitle";
import { ImageAttachmentLightbox, type LightboxItem } from "./ImageAttachmentLightbox";

import {
  TYPEWRITER_INTERVAL_MS,
  getNextTypewriterText,
  hasPendingTypewriterText,
} from "./typewriter";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useChatRun } from "../../hooks/useChatRun";
import type { Message } from "../../mock/uiShellData";
import { type ChatReasoningEventPayload, type ChatShellEventPayload } from "../../../shared/chat";
import type { SkillRecord } from "../../../shared/skills";
import type {
  ChatPermissionDecision,
  ChatPermissionRequest,
} from "../../../shared/chatPermissions";
import {
  DEFAULT_RUNTIME_MODE,
  getRuntimeModeLabel,
  type RuntimeMode,
} from "../../../shared/runtimeMode";
import { runtimeNameMap, type RuntimeId, type RuntimeModelRecord } from "../../../shared/runtimes";
import { RuntimeIcon } from "../RuntimeIcon";
import { useRuntimeModels } from "../../hooks/useRuntimeModels";
import { useRuntimes } from "../../hooks/useRuntimes";
import { useSkills } from "../../hooks/useSkills";
import { getChatRuntimeOptions, isChatRuntimeAvailable } from "../../lib/runtimeSelection";

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
  onHover,
}: {
  status: KimiSessionStatus | null;
  onHover: () => void;
}) {
  const [showPopover, setShowPopover] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(timer);
  }, []);

  if (!status) {
    return null;
  }

  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(status.percentage, 100) / 100);

  return (
    <div
      className={`relative flex h-8 w-8 cursor-pointer items-center justify-center transition-all duration-300 ease-out ${
        mounted ? "scale-100 opacity-100" : "scale-50 opacity-0"
      }`}
      onMouseEnter={() => {
        setShowPopover(true);
        onHover();
      }}
      onMouseLeave={() => setShowPopover(false)}
      title="Kimi context usage"
    >
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
          className={status.percentage > 90 ? "text-danger" : "text-fg"}
        />
      </svg>
      {showPopover && (
        <div className="absolute bottom-full right-0 mb-2 w-52 rounded-lg border border-border-strong bg-surface px-3 py-2 shadow-xl">
          <div className="text-[11px] text-muted">Context usage</div>
          <div className="mt-0.5 text-[12px] font-medium text-fg">
            {status.used.toLocaleString()} / {status.total.toLocaleString()} ({status.percentage.toFixed(1)}%)
          </div>
          {status.model ? (
            <div className="mt-1 truncate text-[11px] text-subtle">{status.model}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

type ComposerProps =
  | {
      mode: "thread";
      projectId: string;
      threadId: string;
      messages: Message[];
      runtimeId: RuntimeId;
      runtimeModelId?: string;
      runtimeMode: RuntimeMode;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModelIdChange?: (modelId: string | undefined) => void;
      onRuntimeModeChange?: (mode: RuntimeMode) => void;
    }
  | {
      mode: "chat";
      threadId: string;
      messages: Message[];
      runtimeId: RuntimeId;
      runtimeModelId?: string;
      runtimeMode: RuntimeMode;
      onRuntimeIdChange?: (runtimeId: RuntimeId) => void;
      onRuntimeModelIdChange?: (modelId: string | undefined) => void;
      onRuntimeModeChange?: (mode: RuntimeMode) => void;
    };

type AttachmentStoreBridge = {
  store: (input: {
    name: string;
    mimeType: string;
    data: Uint8Array;
  }) => Promise<ImageAttachmentMetadata>;
};

function getAttachmentStoreBridge(attachments: unknown): AttachmentStoreBridge {
  if (
    typeof attachments !== "object" ||
    attachments === null ||
    typeof (attachments as { store?: unknown }).store !== "function"
  ) {
    throw new Error("Image attachments are unavailable. Restart Carrent and try again.");
  }

  return attachments as AttachmentStoreBridge;
}

export async function storeImageAttachmentFile(
  file: File,
  attachments: unknown,
): Promise<ImageAttachmentMetadata> {
  const attachmentStore = getAttachmentStoreBridge(attachments);
  const data = new Uint8Array(await file.arrayBuffer());
  return attachmentStore.store({
    name: file.name,
    mimeType: file.type,
    data,
  });
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

export function getRuntimeModelIdForSend({
  runtimeModelId,
}: {
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
    (permission) => permission.threadId === threadId && permission.provider === "kimi",
  );
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

  const right = input.slice(cursor);
  const nextWhitespace = /\s/u.exec(right);

  return {
    start: tokenStart,
    end: nextWhitespace ? cursor + nextWhitespace.index : input.length,
    query,
  };
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

export function replaceSkillSlashTrigger(
  input: string,
  trigger: SkillSlashTrigger,
  skill: SkillRecord,
) {
  const reference = buildSkillReference(skill);
  const trailingSpace = input[trigger.end] === " " ? "" : " ";
  return `${input.slice(0, trigger.start)}${reference}${trailingSpace}${input.slice(trigger.end)}`;
}

export function formatSkillLabel(name: string) {
  const [namespace, ...rest] = name.split(":");
  if (rest.length === 0) {
    return titleCaseSkillName(namespace);
  }

  return `${titleCaseSkillName(namespace)}: ${titleCaseSkillName(rest.join(":"))}`;
}

function titleCaseSkillName(name: string) {
  return name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "ui") return "UI";
      if (part.toLowerCase() === "ux") return "UX";
      if (part.toLowerCase() === "pdf") return "PDF";
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}

export function Composer(props: ComposerProps) {
  const {
    projects,
    chats,
    appendMessage,
    updateMessage,
    updateMessageParts,
    upsertChat,
    upsertThread,
    promoteDraftThread,
  } = useWorkspace();
  const { runningThreadIds, pendingPermissions, respondToPermission, send, stop } = useChatRun();
  const { runtimes, loading: runtimesLoading } = useRuntimes();
  const { skills, loading: skillsLoading, error: skillsError } = useSkills();
  const [input, setInput] = useState("");
  const [textareaCursor, setTextareaCursor] = useState(0);
  const [isTextareaFocused, setIsTextareaFocused] = useState(false);
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
  const [dismissedSkillInput, setDismissedSkillInput] = useState<string | null>(null);
  const [showRuntimePicker, setShowRuntimePicker] = useState(false);
  const [cascadingRuntimeId, setCascadingRuntimeId] = useState<RuntimeId | null>(null);
  const [isPointerOverRuntimeMenu, setIsPointerOverRuntimeMenu] = useState(false);
  const [isPointerOverCascadingPanel, setIsPointerOverCascadingPanel] = useState(false);
  const [cascadingAnchorRect, setCascadingAnchorRect] = useState<RectLike | null>(null);
  const [cascadingPanelPosition, setCascadingPanelPosition] =
    useState<CascadingPanelPosition | null>(null);
  const [showModePicker, setShowModePicker] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [lightboxAttachmentIndex, setLightboxAttachmentIndex] = useState<number | null>(null);
  const [kimiStatus, setKimiStatus] = useState<KimiSessionStatus | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const runtimePickerRef = useRef<HTMLDivElement>(null);
  const cascadingPanelRef = useRef<HTMLDivElement>(null);
  const modePickerRef = useRef<HTMLDivElement>(null);
  const skillItemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const runtimeCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receivedTextRef = useRef("");
  const visibleTextRef = useRef("");
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const flushTypewriterRef = useRef<VoidFunction | null>(null);
  const wasSendingRef = useRef(false);
  const projectId = props.mode === "chat" ? null : props.projectId;
  const project = projectId ? (projects.find((item) => item.id === projectId) ?? null) : null;
  const threadId = props.threadId;

  const refreshKimiStatus = useCallback(async () => {
    if (props.runtimeId !== "kimi") {
      return;
    }

    const workspace =
      props.mode === "chat"
        ? { kind: "chat" as const }
        : {
            kind: "project" as const,
            projectId: props.projectId,
            projectPath: project?.path ?? "",
          };

    const status = await window.carrent.chat.getKimiStatus({
      workspace,
      threadId,
      runtimeId: props.runtimeId,
      runtimeModelId: props.runtimeModelId,
      runtimeMode: props.runtimeMode,
      transcript: [],
      message: "",
    });
    if (status) {
      setKimiStatus(status);
    }
  }, [
    props.mode,
    projectId,
    project?.path,
    threadId,
    props.runtimeId,
    props.runtimeModelId,
    props.runtimeMode,
  ]);

  const runtimeOptions = useMemo(() => getChatRuntimeOptions(runtimes), [runtimes]);
  const modelRuntimeId = props.runtimeId === "pi" ? props.runtimeId : null;
  const { models } = useRuntimeModels(modelRuntimeId);
  const { models: cascadingModels, loading: cascadingLoading } =
    useRuntimeModels(cascadingRuntimeId);
  const selectedRuntimeModel = getDisplayRuntimeModel({
    models,
    runtimeModelId: props.runtimeModelId,
  });
  const isSelectedRuntimeAvailable = isChatRuntimeAvailable(props.runtimeId, runtimes);
  const kimiModelDisplay = kimiStatus?.model?.split("/").pop();
  const runtimeButtonLabel = runtimesLoading
    ? "Checking runtimes"
    : runtimeOptions.length === 0
      ? "No runtime available"
      : isSelectedRuntimeAvailable
        ? props.runtimeId === "kimi" && kimiModelDisplay
          ? kimiModelDisplay
          : selectedRuntimeModel
            ? `${runtimeNameMap[props.runtimeId]} · ${selectedRuntimeModel.name}`
            : runtimeNameMap[props.runtimeId]
        : "Select runtime";
  const skillTrigger = useMemo(
    () => (isTextareaFocused ? getSkillSlashTrigger(input, textareaCursor) : null),
    [input, isTextareaFocused, textareaCursor],
  );
  const filteredSkills = useMemo(
    () => (skillTrigger ? filterSkillsForQuery(skills, skillTrigger.query) : []),
    [skillTrigger, skills],
  );
  const showSkillMenu =
    !!skillTrigger &&
    dismissedSkillInput !== input &&
    (skillsLoading || !!skillsError || filteredSkills.length > 0 || skillTrigger.query.length > 0);

  const hasSendableContent = !!input.trim() || pendingAttachments.length > 0;
  const canSend =
    (props.mode === "chat" ? hasSendableContent : hasSendableContent && !!project) &&
    isSelectedRuntimeAvailable;
  const isThreadSending = runningThreadIds.includes(threadId);
  const threadPermissions = useMemo(
    () => getActionablePermissionsForThread({ pendingPermissions, threadId }),
    [pendingPermissions, threadId],
  );
  const showCascadingPanel =
    showRuntimePicker && cascadingRuntimeId === "pi" && !!props.onRuntimeModelIdChange;
  const cascadingPanelTransitionClass = !cascadingPanelPosition
    ? "pointer-events-none opacity-0 translate-y-1 scale-95"
    : "opacity-100 translate-x-0 translate-y-0 scale-100";

  const stopTypewriter = () => {
    if (typewriterTimerRef.current) {
      clearInterval(typewriterTimerRef.current);
      typewriterTimerRef.current = null;
    }
  };

  const flushActiveTypewriter = () => {
    stopTypewriter();
    flushTypewriterRef.current?.();
  };

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
      flushActiveTypewriter();
      if (runtimeCloseTimerRef.current) {
        clearTimeout(runtimeCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setKimiStatus(null);
  }, [threadId]);

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
    if (!showRuntimePicker && !showModePicker) return;

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
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showRuntimePicker) {
          closeRuntimePicker();
        }
        if (showModePicker) {
          setShowModePicker(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showRuntimePicker, showModePicker]);

  useEffect(() => {
    setSelectedSkillIndex(0);
  }, [skillTrigger?.query, filteredSkills.length]);

  useEffect(() => {
    if (!showSkillMenu) {
      return;
    }

    const selectedButton = skillItemRefs.current.get(selectedSkillIndex);
    if (selectedButton) {
      selectedButton.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedSkillIndex, showSkillMenu]);

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
      if (!files || files.length === 0) {
        return;
      }

      const fileArray = Array.from(files);
      const validation = validateImageAttachments([
        ...pendingAttachments.map((pending) => pending.file),
        ...fileArray,
      ]);

      if (!validation.ok) {
        setAttachmentError(validation.reason);
        return;
      }

      setAttachmentError(null);

      for (const file of fileArray) {
        try {
          const metadata = await storeImageAttachmentFile(file, window.carrent?.attachments);
          const pendingAttachment = pendingAttachmentFromFile(file, metadata);
          setPendingAttachments((prev) => [...prev, pendingAttachment]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setAttachmentError(`Failed to attach ${file.name}: ${message}`);
          return;
        }
      }
    },
    [pendingAttachments],
  );

  const handleRemovePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const files = event.clipboardData?.files;
      if (!files || files.length === 0) {
        return;
      }

      const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();
      const dataTransfer = new DataTransfer();
      imageFiles.forEach((file) => dataTransfer.items.add(file));
      void handleAddFiles(dataTransfer.files);
    },
    [handleAddFiles],
  );

  const handleSend = async () => {
    if (!canSend) return;

    if (props.mode === "thread") {
      promoteDraftThread(props.projectId, props.threadId);
    }

    const validation = validateImageAttachments(pendingAttachments.map((pending) => pending.file));
    if (!validation.ok) {
      setAttachmentError(validation.reason);
      return;
    }

    if (pendingAttachments.some((pending) => !pending.metadata)) {
      setAttachmentError("Some attachments are still being prepared.");
      return;
    }

    const messageText = input.trim();
    const attachmentMetadata: ImageAttachmentMetadata[] = metadataOnly(
      pendingAttachments.map((pending) => pending.metadata!),
    );

    setAttachmentError(null);

    const appendLocalMessage = (
      role: "user" | "assistant",
      content: string,
      attachments?: ImageAttachmentMetadata[],
    ) =>
      appendMessage({
        threadId,
        role,
        content,
        attachments,
      });

    const updateLocalMessage = (messageId: string, content: string) => {
      updateMessage(messageId, content);
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

    const flushPendingTypewriterText = () => {
      const activeMessageId = activeAssistantMessageIdRef.current;
      if (!activeMessageId) {
        return;
      }

      if (visibleTextRef.current !== receivedTextRef.current) {
        const nextText = receivedTextRef.current;
        const delta = nextText.slice(visibleTextRef.current.length);
        visibleTextRef.current = nextText;
        updateLocalMessageTextPart(activeMessageId, delta);
      }
    };

    const startTypewriter = (messageId: string) => {
      activeAssistantMessageIdRef.current = messageId;

      if (typewriterTimerRef.current) {
        return;
      }

      typewriterTimerRef.current = setInterval(() => {
        const nextVisibleText = getNextTypewriterText(
          visibleTextRef.current,
          receivedTextRef.current,
        );

        if (nextVisibleText !== visibleTextRef.current) {
          const delta = nextVisibleText.slice(visibleTextRef.current.length);
          visibleTextRef.current = nextVisibleText;
          updateLocalMessageTextPart(messageId, delta);
        }

        if (!hasPendingTypewriterText(visibleTextRef.current, receivedTextRef.current)) {
          stopTypewriter();
        }
      }, TYPEWRITER_INTERVAL_MS);
    };

    appendLocalMessage("user", messageText, attachmentMetadata);
    const assistantMsg = appendLocalMessage("assistant", "");

    flushActiveTypewriter();
    receivedTextRef.current = "";
    visibleTextRef.current = "";
    activeAssistantMessageIdRef.current = assistantMsg.id;
    flushTypewriterRef.current = () => {
      const activeMessageId = activeAssistantMessageIdRef.current;
      if (!activeMessageId) {
        return;
      }

      flushPendingTypewriterText();

      activeAssistantMessageIdRef.current = null;
      flushTypewriterRef.current = null;
    };

    const transcript = props.messages
      .filter((m) => m.type !== "changed_files")
      .slice(-6)
      .map((m) => ({
        role: m.role,
        content: m.content ?? "",
      }));

    const sendStarted = await send(
      {
        workspace:
          props.mode === "chat"
            ? { kind: "chat" }
            : {
                kind: "project",
                projectId: props.projectId,
                projectPath: project!.path,
              },
        threadId,
        runtimeId: props.runtimeId,
        runtimeModelId: getRuntimeModelIdForSend({
          runtimeModelId: props.runtimeModelId,
        }),
        runtimeMode: props.runtimeMode,
        transcript,
        message: messageText,
        attachments: attachmentMetadata,
      },
      {
        onDelta: (text) => {
          receivedTextRef.current += text;
          startTypewriter(assistantMsg.id);
        },
        onReasoning: (reasoning) => {
          stopTypewriter();
          flushPendingTypewriterText();
          updateLocalMessageReasoningPart(assistantMsg.id, reasoning);
        },
        onShell: (shell) => {
          stopTypewriter();
          flushPendingTypewriterText();
          updateLocalMessageShellPart(assistantMsg.id, shell);
        },
        onComplete: (text) => {
          if (!receivedTextRef.current || text.startsWith(receivedTextRef.current)) {
            receivedTextRef.current = text;
          }
          startTypewriter(assistantMsg.id);
        },
        onError: (error) => {
          stopTypewriter();
          updateLocalMessage(assistantMsg.id, `Error: ${error}`);
          activeAssistantMessageIdRef.current = null;
          flushTypewriterRef.current = null;
        },
        onStop: () => {
          stopTypewriter();
          updateLocalMessage(
            assistantMsg.id,
            `${receivedTextRef.current || visibleTextRef.current}\n\n[Stopped]`,
          );
          activeAssistantMessageIdRef.current = null;
          flushTypewriterRef.current = null;
        },
      },
    );

    if (!sendStarted) {
      return;
    }

    setInput("");
    setPendingAttachments((prev) => {
      prev.forEach((pending) => URL.revokeObjectURL(pending.previewUrl));
      return [];
    });

    if (props.mode === "chat") {
      const chatThread = chats.find((c) => c.id === threadId);
      if (chatThread && chatThread.title === "New chat") {
        const title =
          deriveThreadTitle(messageText, { fallback: "" }) ||
          attachmentMetadata[0]?.name ||
          "Image message";
        upsertChat({ ...chatThread, title });
      }
    }

    if (props.mode === "thread") {
      const thread = project?.threads.find((t) => t.id === threadId);
      if (thread && thread.title === "New thread") {
        const title =
          deriveThreadTitle(messageText, { fallback: "" }) ||
          attachmentMetadata[0]?.name ||
          "New thread";
        upsertThread(props.projectId, { ...thread, title, draft: undefined });
      }
    }
  };

  const updateTextareaCursor = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    setTextareaCursor(textarea.selectionStart);
  };

  const handleSkillInsert = (skill: SkillRecord) => {
    if (!skillTrigger) {
      return;
    }

    const nextInput = replaceSkillSlashTrigger(input, skillTrigger, skill);
    const nextCursor = skillTrigger.start + buildSkillReference(skill).length + 1;
    setInput(nextInput);
    setDismissedSkillInput(null);
    setTextareaCursor(nextCursor);

    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handlePermissionResponse = (
    permission: ChatPermissionRequest,
    decision: ChatPermissionDecision,
  ) => {
    void respondToPermission({
      runId: permission.runId,
      permissionId: permission.id,
      decision,
    });
  };

  return (
    <div className="px-6 pb-5 pt-2" onPaste={handlePaste}>
      <div className="relative mx-auto max-w-[56rem]">
        {showSkillMenu ? (
          <div className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[0_18px_60px_rgb(0_0_0/0.28)]">
            <div className="px-3 py-2 text-[12px] font-medium text-muted">Skills</div>
            <div className="max-h-80 overflow-y-auto p-1">
              {skillsLoading ? (
                <div className="px-3 py-2 text-[12px] text-subtle">Loading skills...</div>
              ) : skillsError ? (
                <div className="px-3 py-2 text-[12px] text-danger">{skillsError}</div>
              ) : filteredSkills.length > 0 ? (
                filteredSkills.map((skill, index) => {
                  const isSelected = index === selectedSkillIndex;

                  return (
                    <button
                      key={skill.path}
                      ref={(element) => {
                        if (element) {
                          skillItemRefs.current.set(index, element);
                        } else {
                          skillItemRefs.current.delete(index);
                        }
                      }}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSkillInsert(skill);
                      }}
                      onMouseEnter={() => setSelectedSkillIndex(index)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left transition ${
                        isSelected ? "bg-surface-hover" : "hover:bg-surface-raised"
                      }`}
                    >
                      <Box className="h-4 w-4 shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-[13px] font-medium text-fg">
                          {formatSkillLabel(skill.name)}
                        </span>
                        <span className="ml-2 text-[12px] text-subtle">{skill.description}</span>
                      </span>
                      <span className="shrink-0 text-[10px] uppercase text-subtle">
                        {skill.source}
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="px-3 py-2 text-[12px] text-subtle">No skills found.</div>
              )}
            </div>
          </div>
        ) : null}
        <div className="rounded-2xl border border-border bg-surface-raised/90 p-3 shadow-[0_18px_60px_rgb(0_0_0/0.18)]">
          {threadPermissions.length > 0 ? (
            <div className="mb-2 space-y-2">
              {threadPermissions.map((permission) => (
                <div
                  key={permission.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border-strong bg-bg/45 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-fg">
                      {permission.title}
                    </div>
                    <div className="truncate text-[11px] text-subtle">
                      {getPermissionDetail(permission)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handlePermissionResponse(permission, "denied")}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-border-strong text-muted transition hover:bg-surface-hover hover:text-fg active:scale-95"
                      title="Deny"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePermissionResponse(permission, "approved")}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-90 active:scale-95"
                      title="Approve"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {pendingAttachments.map((attachment, index) => (
                <div
                  key={attachment.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLightboxAttachmentIndex(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setLightboxAttachmentIndex(index);
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
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setTextareaCursor(e.target.selectionStart);
              setDismissedSkillInput(null);
            }}
            onFocus={(event) => {
              setIsTextareaFocused(true);
              setTextareaCursor(event.currentTarget.selectionStart);
            }}
            onBlur={() => {
              setIsTextareaFocused(false);
            }}
            onClick={updateTextareaCursor}
            onSelect={updateTextareaCursor}
            placeholder="Message..."
            className="min-h-16 w-full resize-none bg-transparent text-[15px] leading-6 text-fg placeholder:text-subtle outline-none"
            rows={2}
            onKeyDown={(e) => {
              if (showSkillMenu) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedSkillIndex((index) =>
                    filteredSkills.length === 0 ? 0 : (index + 1) % filteredSkills.length,
                  );
                  return;
                }

                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedSkillIndex((index) =>
                    filteredSkills.length === 0
                      ? 0
                      : (index - 1 + filteredSkills.length) % filteredSkills.length,
                  );
                  return;
                }

                if ((e.key === "Enter" || e.key === "Tab") && filteredSkills.length > 0) {
                  e.preventDefault();
                  handleSkillInsert(filteredSkills[selectedSkillIndex] ?? filteredSkills[0]);
                  return;
                }

                if (e.key === "Escape") {
                  e.preventDefault();
                  setDismissedSkillInput(input);
                  return;
                }
              }

              if (shouldSubmitComposerOnKeyDown(e)) {
                e.preventDefault();
                if (canSend && !isThreadSending) {
                  handleSend();
                }
              }
            }}
          />
          {attachmentError && <div className="mt-2 text-[12px] text-danger">{attachmentError}</div>}
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {props.onRuntimeIdChange ? (
                <div ref={runtimePickerRef} className="relative">
                  <button
                    onClick={() => {
                      if (!isThreadSending) {
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
                    disabled={isThreadSending}
                    className={`flex max-w-[18rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-40 ${
                      showRuntimePicker
                        ? "border-fg/20 bg-surface-hover text-fg"
                        : "border-border-strong bg-surface-raised text-muted hover:bg-surface-hover hover:text-fg"
                    }`}
                    title={isThreadSending ? "Locked while runtime is running" : "Runtime"}
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
                            runtime.id === "pi" && props.onRuntimeModelIdChange;

                          return (
                            <button
                              key={runtime.id}
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
                                if (runtime.id !== "pi" || !props.onRuntimeModelIdChange) {
                                  props.onRuntimeModelIdChange?.(undefined);
                                  closeRuntimePicker();
                                  return;
                                }

                                if (cascadingRuntimeId !== "pi") {
                                  closeRuntimePicker();
                                  return;
                                }

                                closeRuntimePicker();
                              }}
                              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-surface-raised ${
                                runtime.id === props.runtimeId ? "text-fg" : "text-muted"
                              }`}
                            >
                              <RuntimeIcon name={runtime.name} size="xs" />
                              <span className="min-w-0 flex-1">
                                {runtime.id === "kimi" && kimiModelDisplay
                                  ? kimiModelDisplay
                                  : runtime.name}
                              </span>
                              {supportsModelCascade ? (
                                <ChevronDown className="ml-auto h-3 w-3 shrink-0" />
                              ) : null}
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-3 py-2 text-[12px] leading-5 text-subtle">
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
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          pi models
                        </div>
                      </div>
                      <div className="max-h-[calc(100vh-24px)] overflow-y-auto px-1 pb-1">
                        {props.runtimeModelId &&
                        !cascadingModels.some((model) => model.id === props.runtimeModelId) ? (
                          <button
                            onClick={() => {
                              props.onRuntimeIdChange?.("pi");
                              props.onRuntimeModelIdChange?.(props.runtimeModelId);
                              closeRuntimePicker();
                            }}
                            className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-[12px] text-fg transition hover:bg-surface-raised"
                          >
                            <span className="min-w-0 truncate">{props.runtimeModelId}</span>
                            <Check className="h-3.5 w-3.5 shrink-0 text-fg" />
                          </button>
                        ) : null}

                        {cascadingLoading ? (
                          <div className="px-3 py-2 text-[12px] leading-5 text-subtle">
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
                                  props.onRuntimeIdChange?.("pi");
                                  props.onRuntimeModelIdChange?.(model.id);
                                  closeRuntimePicker();
                                }}
                                className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-[12px] transition hover:bg-surface-raised ${
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
                          <div className="px-3 py-2 text-[12px] leading-5 text-subtle">
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
                      if (!isThreadSending) {
                        setShowModePicker((v) => !v);
                      }
                    }}
                    disabled={isThreadSending}
                    className={`flex max-w-[12rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-40 ${
                      showModePicker
                        ? "border-fg/20 bg-surface-hover text-fg"
                        : "border-border-strong bg-surface-raised text-muted hover:bg-surface-hover hover:text-fg"
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
                      {getRuntimeModeLabel(props.runtimeMode ?? DEFAULT_RUNTIME_MODE)}
                    </span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {showModePicker && (
                    <div className="absolute bottom-full left-0 mb-1.5 w-44 rounded-lg border border-border-strong bg-surface py-1 shadow-xl">
                      {(
                        ["approval-required", "auto-accept-edits", "full-access"] as RuntimeMode[]
                      ).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => {
                            props.onRuntimeModeChange!(mode);
                            setShowModePicker(false);
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-surface-raised ${
                            mode === props.runtimeMode ? "text-fg" : "text-muted"
                          }`}
                        >
                          <RuntimeModeIcon mode={mode} className="h-3 w-3" />
                          <span>
                            {getRuntimeModeLabel(mode)}
                            {mode === "full-access" ? " (danger)" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
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
                disabled={isThreadSending}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong text-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-40"
                title="Attach image"
              >
                <Image className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {props.runtimeId === "kimi" ? (
                <ContextUsageIndicator
                  key={threadId}
                  status={kimiStatus}
                  onHover={refreshKimiStatus}
                />
              ) : null}
              {isThreadSending ? (
                <button
                  onClick={() => stop(threadId)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black transition hover:opacity-90 active:scale-95"
                >
                  <div className="h-3 w-3 rounded-[2px] bg-current" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!canSend || isThreadSending}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg transition hover:opacity-90 active:scale-95 disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {lightboxAttachmentIndex !== null && (
            <ImageAttachmentLightbox
              items={pendingAttachments.map(
                (attachment): LightboxItem => ({
                  id: attachment.id,
                  name: attachment.file.name,
                  url: attachment.previewUrl,
                }),
              )}
              initialIndex={lightboxAttachmentIndex}
              onClose={() => setLightboxAttachmentIndex(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
