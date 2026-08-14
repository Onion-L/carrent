import {
  AlertCircle,
  ArrowDown,
  Bot,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  FileText,
  Folder,
  Loader2,
  Pencil,
  XCircle,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  type Message,
  type MessagePart,
  type AttachmentMetadata,
  type SubagentTaskPart,
} from "../../../shared/threadContent";
import type { AppThreadActionRecord } from "../../../shared/workspacePersistence";
import type { LocalPathContextItem } from "../../../shared/localPathContext";
import { isFileAttachment, isImageAttachment } from "../../../shared/attachment";
import {
  FILE_ATTACHMENT_ICONS,
  fileAttachmentIconKind,
  formatAttachmentSize,
} from "../../lib/attachments";
import {
  AgentActivityBlock,
  AgentActivityList,
  type AgentActivityItem,
} from "./AgentActivityBlock";
import { ChangedFilesCard } from "./ChangedFilesCard";
import { ErrorBlock } from "./ErrorBlock";
import { ImageAttachmentLightbox, type StoredLightboxItem } from "./ImageAttachmentLightbox";
import { MarkdownContent } from "./MarkdownContent";
import { PlanReviewBlock } from "./PlanReviewBlock";
import { QuestionBlock } from "./QuestionBlock";
import { parseFileReferenceSegments } from "./fileReferences";
import { formatSkillLabel } from "./skillLabel";
import { useToast } from "../toast/ToastContext";

export { parseFileReferenceSegments } from "./fileReferences";

type UserMessageSegment =
  | { type: "text"; content: string }
  | { type: "skill"; name: string; path: string }
  | { type: "file"; label: string; path: string };

export type UserMessageEditDraft = {
  messageId: string;
  content: string;
  attachments?: AttachmentMetadata[];
  localPathContexts?: LocalPathContextItem[];
};

export type RuntimeSessionRetryRequest = NonNullable<
  Extract<MessagePart, { type: "error" }>["runtimeSessionRecovery"]
>;

function getMessageTimestamp(message: Message) {
  if (message.timestamp) return message.timestamp;
  if (message.createdAt === undefined) return "";
  const date = new Date(message.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const SKILL_REFERENCE_PATTERN = /\[\$([^\]\n]+)\]\(([^)\n]+\/SKILL\.md)\)/gu;
const LEADING_SKILL_REFERENCE_PATTERN = /^\s*(\[\$([^\]\n]+)\]\(([^)\n]+\/SKILL\.md)\))\s*/u;

const NEAR_BOTTOM_THRESHOLD = 80;

function distanceToBottom(el: HTMLDivElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

export function parseSkillReferenceSegments(content: string): UserMessageSegment[] {
  const segments: UserMessageSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(SKILL_REFERENCE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", content: content.slice(lastIndex, index) });
    }

    segments.push({ type: "skill", name: match[1], path: match[2] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", content: content.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", content }];
}

export function getUserMessageEditDraft(message: Message): UserMessageEditDraft | null {
  if (
    message.role !== "user" ||
    (!message.content.trim() && !message.attachments?.length && !message.localPathContexts?.length)
  ) {
    return null;
  }

  return {
    messageId: message.id,
    content: message.content,
    attachments: message.attachments,
    localPathContexts: message.localPathContexts,
  };
}

export function splitLeadingSkillReferences(content: string) {
  const skills: Extract<UserMessageSegment, { type: "skill" }>[] = [];
  const references: string[] = [];
  let rest = content;

  while (true) {
    const match = LEADING_SKILL_REFERENCE_PATTERN.exec(rest);
    if (!match) break;

    references.push(match[1]);
    skills.push({ type: "skill", name: match[2], path: match[3] });
    rest = rest.slice(match[0].length);
  }

  return {
    skills,
    prefix: references.length > 0 ? `${references.join(" ")} ` : "",
    body: references.length > 0 ? rest.trimStart() : rest,
  };
}

export function buildUserMessageEditContent(prefix: string, body: string) {
  return `${prefix}${body.trim()}`.trim();
}

function SkillBadge({ name, path }: { name: string; path: string }) {
  return (
    <span
      title={path}
      className="inline-flex max-w-full items-center gap-1.5 align-middle font-medium text-skill-reference"
    >
      <Box className="h-4 w-4 shrink-0" strokeWidth={2} />
      <span className="truncate">{formatSkillLabel(name)}</span>
    </span>
  );
}

function FileReferenceBadge({ label, path }: { label: string; path: string }) {
  const filePath = path.replace(/:\d+(?::\d+)?$/u, "");
  return (
    <button
      type="button"
      title={path}
      onClick={() => {
        void window.carrent.shell.openPath(filePath);
      }}
      className="inline-flex max-w-full items-center gap-1 align-middle text-skill-reference hover:underline"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <span className="break-all">{label}</span>
    </button>
  );
}

function UserMessageTextContent({ content }: { content: string }) {
  return (
    <>
      {parseFileReferenceSegments(content).map((segment, index) =>
        segment.type === "file" ? (
          <FileReferenceBadge
            key={`${index}-${segment.path}`}
            label={segment.label}
            path={segment.path}
          />
        ) : (
          <span key={`${index}-text`}>{segment.content}</span>
        ),
      )}
    </>
  );
}

function UserMessageContent({ content }: { content: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-app-14 leading-relaxed text-user-bubble-fg">
      {parseSkillReferenceSegments(content).map((segment, index) => {
        if (segment.type === "skill") {
          return (
            <SkillBadge key={`${index}-${segment.name}`} name={segment.name} path={segment.path} />
          );
        }

        if (segment.type === "text") {
          return <UserMessageTextContent key={`${index}-text`} content={segment.content} />;
        }

        return null;
      })}
    </p>
  );
}

function StoredAttachmentThumbnail({
  attachment,
  onClick,
}: {
  attachment: AttachmentMetadata;
  onClick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    window.carrent.attachments
      .read(attachment)
      .then((data) => {
        const blob = new Blob([data.slice()], { type: attachment.mimeType });
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setUrl(objectUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachment.storageKey, attachment.mimeType]);

  if (failed || !url) {
    return (
      <div
        title={attachment.name}
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface text-app-11 text-muted"
      >
        {failed ? "文件不可用" : "..."}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 overflow-hidden rounded-lg border border-border-strong"
      title={attachment.name}
    >
      <img
        src={url}
        alt={attachment.name}
        className="h-16 w-16 object-cover"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function FileAttachmentRow({ attachment }: { attachment: AttachmentMetadata }) {
  const FileIcon = FILE_ATTACHMENT_ICONS[fileAttachmentIconKind(attachment.name)];
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.carrent.attachments.read(attachment).catch(() => {
      if (!cancelled) setUnavailable(true);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment]);

  return (
    <div title={attachment.name} className="flex h-7 items-center gap-2">
      <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
      <span className="min-w-0 truncate text-app-12 leading-5 text-user-bubble-fg">
        {attachment.name}
      </span>
      <span className="shrink-0 text-app-11 leading-4 text-subtle">
        {unavailable ? "文件不可用" : formatAttachmentSize(attachment.size)}
      </span>
    </div>
  );
}

export function UserMessageAttachmentList({
  attachments,
  onImageClick,
}: {
  attachments: AttachmentMetadata[];
  onImageClick?: (imageIndex: number) => void;
}) {
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter(isFileAttachment);

  return (
    <>
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((attachment, index) => (
            <StoredAttachmentThumbnail
              key={attachment.id}
              attachment={attachment}
              onClick={() => onImageClick?.(index)}
            />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className={`flex flex-col ${images.length > 0 ? "mt-2" : ""}`}>
          {files.map((attachment) => (
            <FileAttachmentRow key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
    </>
  );
}

export function UserMessageLocalPathContextList({ items }: { items: LocalPathContextItem[] }) {
  const { showToast } = useToast();

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <button
          key={`${item.kind}:${item.path}`}
          type="button"
          data-local-path-context-badge
          title={item.path}
          aria-label={`Reveal ${item.basename} in Finder`}
          onClick={() => {
            void window.carrent.shell
              .revealPath(item.path)
              .then((result) => {
                if (!result.revealed) {
                  showToast(
                    `Could not reveal “${item.basename}”: the path no longer exists.`,
                    "error",
                  );
                }
              })
              .catch(() => {
                showToast(`Could not reveal “${item.basename}” in the file manager.`, "error");
              });
          }}
          className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-md border border-border-strong bg-bg/45 px-2 text-app-11 text-fg outline-none transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-fg/25"
        >
          {item.kind === "directory" ? (
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted" />
          ) : (
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
          )}
          <span className="truncate font-medium">{item.basename}</span>
          <span className="shrink-0 text-subtle">
            {item.kind === "directory" ? "Folder" : "File"}
          </span>
        </button>
      ))}
    </div>
  );
}

function UserMessage({
  content,
  timestamp,
  attachments,
  localPathContexts,
  isEditing,
  onEdit,
  onCancelEdit,
  onSubmitEdit,
}: {
  content: string;
  timestamp: string;
  attachments?: AttachmentMetadata[];
  localPathContexts?: LocalPathContextItem[];
  isEditing?: boolean;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: (content: string, localPathContexts: LocalPathContextItem[]) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const editState = useMemo(() => splitLeadingSkillReferences(content), [content]);
  const [draftBody, setDraftBody] = useState(editState.body);
  const [draftLocalPathContexts, setDraftLocalPathContexts] = useState(localPathContexts ?? []);

  useEffect(() => {
    if (isEditing) {
      setDraftBody(editState.body);
      setDraftLocalPathContexts(localPathContexts ?? []);
    }
  }, [editState.body, isEditing, localPathContexts]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const lightboxItems: StoredLightboxItem[] =
    attachments?.filter(isImageAttachment).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      storageKey: attachment.storageKey,
      mimeType: attachment.mimeType,
      size: attachment.size,
      ...(attachment.sha256 ? { sha256: attachment.sha256 } : {}),
    })) ?? [];
  const editedContent = buildUserMessageEditContent(editState.prefix, draftBody);
  const canSubmitEdit =
    !!editedContent.trim() || !!attachments?.length || draftLocalPathContexts.length > 0;

  const handleSubmitEdit = () => {
    if (!canSubmitEdit) return;
    onSubmitEdit?.(editedContent, draftLocalPathContexts);
  };

  if (isEditing) {
    return (
      <div className="relative flex justify-end">
        <div className="w-full max-w-[90%] rounded-xl rounded-tr-sm border border-user-bubble-fg/10 bg-user-bubble p-3 shadow-lg">
          {editState.skills.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {editState.skills.map((skill) => (
                <SkillBadge key={skill.path} name={skill.name} path={skill.path} />
              ))}
            </div>
          )}
          <textarea
            aria-label="编辑消息"
            rows={8}
            value={draftBody}
            onChange={(event) => setDraftBody(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                handleSubmitEdit();
              }
            }}
            className="block min-h-48 max-h-[55vh] w-full resize-y overflow-y-auto rounded-lg border border-user-bubble-fg/10 bg-user-bubble-fg/[0.04] px-3 py-2 text-app-15 leading-6 text-user-bubble-fg outline-none transition focus-visible:border-user-bubble-fg/30 focus-visible:ring-2 focus-visible:ring-user-bubble-fg/15"
            autoFocus
          />
          {attachments && attachments.length > 0 && (
            <div className="mt-2">
              <UserMessageAttachmentList
                attachments={attachments}
                onImageClick={setLightboxIndex}
              />
            </div>
          )}
          {draftLocalPathContexts.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {draftLocalPathContexts.map((item) => (
                <div
                  key={`${item.kind}:${item.path}`}
                  data-local-path-context-card
                  title={item.path}
                  className="flex h-10 min-w-0 max-w-full basis-52 items-center rounded-lg border border-user-bubble-fg/15 bg-user-bubble-fg/[0.04]"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
                    {item.kind === "directory" ? (
                      <Folder className="h-4 w-4 shrink-0" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0" />
                    )}
                    <span className="truncate text-app-12">{item.basename}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftLocalPathContexts((current) =>
                        current.filter(
                          (candidate) =>
                            candidate.path !== item.path || candidate.kind !== item.kind,
                        ),
                      )
                    }
                    aria-label={`Remove ${item.basename}`}
                    title={`Remove ${item.basename}`}
                    className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-user-bubble-fg/70 transition hover:bg-user-bubble-fg/10 hover:text-user-bubble-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-user-bubble-fg/25"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex justify-end gap-2 border-t border-user-bubble-fg/10 pt-3">
            <button
              type="button"
              onClick={onCancelEdit}
              className="min-h-8 rounded-md px-3 py-1.5 text-app-12 font-medium text-user-bubble-fg/75 transition hover:bg-user-bubble-fg/10 hover:text-user-bubble-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-user-bubble-fg/25"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmitEdit}
              disabled={!canSubmitEdit}
              className="min-h-8 rounded-md bg-user-bubble-fg px-3 py-1.5 text-app-12 font-medium text-user-bubble transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-user-bubble-fg/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              发送
            </button>
          </div>
          {lightboxIndex !== null && (
            <ImageAttachmentLightbox
              items={lightboxItems}
              initialIndex={lightboxIndex}
              onClose={() => setLightboxIndex(null)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex justify-end"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="max-w-[80%]">
        {content || (attachments && attachments.length > 0) ? (
          <div className="rounded-2xl rounded-tr-sm bg-user-bubble px-4 py-3">
            {content && <UserMessageContent content={content} />}
            {attachments && attachments.length > 0 && (
              <div className={content ? "mt-2" : ""}>
                <UserMessageAttachmentList
                  attachments={attachments}
                  onImageClick={setLightboxIndex}
                />
              </div>
            )}
          </div>
        ) : null}
        {localPathContexts && localPathContexts.length > 0 ? (
          <div className="mt-1.5 flex justify-end">
            <UserMessageLocalPathContextList items={localPathContexts} />
          </div>
        ) : null}
        {lightboxIndex !== null && (
          <ImageAttachmentLightbox
            items={lightboxItems}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </div>
      {hovered && (
        <div className="absolute -bottom-6 right-0 flex items-center gap-3 px-1">
          <span className="text-app-12 text-subtle">{timestamp}</span>
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className="flex h-6 w-6 items-center justify-center rounded text-subtle transition hover:text-muted"
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          ) : null}
          <button
            onClick={handleCopy}
            className="flex h-6 w-6 items-center justify-center rounded text-subtle transition hover:text-muted"
            title="Copy"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

type ActivityPart = Extract<MessagePart, { type: "reasoning" | "shell" }>;

export type KimiTimelinePresentationItem =
  | Extract<AgentActivityItem, { type: "kimi-thinking" | "kimi-tool" }>
  | { type: "text"; id: string; content: string }
  | { type: "kimi-subagent"; task: SubagentTaskPart };

function KimiSubagentItem({
  task,
  onSelect,
}: {
  task: SubagentTaskPart;
  onSelect?: (taskId: string) => void;
}) {
  const StatusIcon =
    task.status === "completed"
      ? CheckCircle2
      : task.status === "failed"
        ? XCircle
        : task.status === "interrupted"
          ? AlertCircle
          : task.status === "detached"
            ? CircleDot
            : Loader2;
  const statusClass =
    task.status === "completed"
      ? "text-success"
      : task.status === "failed"
        ? "text-danger"
        : "text-muted";

  return (
    <button
      type="button"
      onClick={() => onSelect?.(task.id)}
      className="group flex w-full min-w-0 items-center gap-2 text-left text-app-13 leading-5"
      title={task.summary ?? task.prompt ?? task.description}
    >
      <Bot className="h-4 w-4 shrink-0 text-muted" />
      <span className="shrink-0 font-medium text-fg">Subagent</span>
      {task.agentType ? (
        <span className="shrink-0 font-mono text-skill-reference">{task.agentType}</span>
      ) : null}
      <span className="text-subtle">·</span>
      <span className="min-w-0 flex-1 truncate text-muted">{task.description}</span>
      <StatusIcon
        className={`h-3.5 w-3.5 shrink-0 ${statusClass} ${task.status === "running" ? "animate-spin" : ""}`}
      />
    </button>
  );
}

function isRawThoughtPart(part: ActivityPart) {
  return part.type === "reasoning" && part.id.startsWith("kimi-thinking-");
}

export type KimiTimelineGroupableItem = Extract<
  KimiTimelinePresentationItem,
  { type: "kimi-thinking" | "kimi-tool" | "kimi-subagent" }
>;

export type KimiTimelineActivityGroup = {
  type: "kimi-activity-group";
  id: string;
  items: KimiTimelineGroupableItem[];
};

export type KimiTimelineDisplayItem = KimiTimelinePresentationItem | KimiTimelineActivityGroup;

function kimiTimelineItemId(item: KimiTimelineGroupableItem) {
  return item.type === "kimi-subagent" ? item.task.id : item.id;
}

// Collapses runs of consecutive thinking/tool/subagent entries into a single
// expandable group. Text messages break a run, so the visible order of events
// is never changed. Runs of a single item stay inline.
export function groupKimiTimelineItems(
  items: KimiTimelinePresentationItem[],
): KimiTimelineDisplayItem[] {
  const result: KimiTimelineDisplayItem[] = [];
  let buffer: KimiTimelineGroupableItem[] = [];

  const flush = () => {
    if (buffer.length >= 2) {
      result.push({
        type: "kimi-activity-group",
        id: `kimi-activity-group-${kimiTimelineItemId(buffer[0]!)}`,
        items: buffer,
      });
    } else {
      result.push(...buffer);
    }
    buffer = [];
  };

  for (const item of items) {
    if (item.type === "text") {
      flush();
      result.push(item);
    } else {
      buffer.push(item);
    }
  }
  flush();

  return result;
}

export function formatKimiActivityGroupLabel(
  items: KimiTimelineGroupableItem[],
  { active = false }: { active?: boolean } = {},
) {
  const thoughts = items.filter((item) => item.type === "kimi-thinking").length;
  const tools = items.filter((item) => item.type === "kimi-tool").length;
  const subagents = items.length - thoughts - tools;
  const parts: string[] = [];
  if (tools > 0) parts.push(`${tools} tool call${tools === 1 ? "" : "s"}`);
  if (thoughts > 0) parts.push(`${thoughts} thought${thoughts === 1 ? "" : "s"}`);
  if (subagents > 0) parts.push(`${subagents} subagent${subagents === 1 ? "" : "s"}`);
  return `${active ? "Running" : "Ran"} ${parts.join(" · ")}`;
}

function isKimiTimelineItemActive(item: KimiTimelineGroupableItem) {
  if (item.type === "kimi-subagent") {
    return item.task.status === "running";
  }
  if (item.status === "running") {
    return true;
  }
  return item.type === "kimi-tool" && item.status === "pending";
}

function renderKimiTimelineItem(
  item: KimiTimelinePresentationItem,
  onSelectSubagent?: (taskId: string) => void,
) {
  if (item.type === "text") {
    return <MarkdownContent key={item.id}>{item.content}</MarkdownContent>;
  }
  if (item.type === "kimi-thinking" || item.type === "kimi-tool") {
    return <AgentActivityList key={item.id} items={[item]} />;
  }
  return <KimiSubagentItem key={item.task.id} task={item.task} onSelect={onSelectSubagent} />;
}

function KimiActivityGroup({
  group,
  hasFollowingText,
  onSelectSubagent,
}: {
  group: KimiTimelineActivityGroup;
  hasFollowingText: boolean;
  onSelectSubagent?: (taskId: string) => void;
}) {
  const isActive = group.items.some(isKimiTimelineItemActive);
  const shouldCollapse = !isActive && hasFollowingText;
  const [expanded, setExpanded] = useState(!shouldCollapse);

  // Groups stay expanded while running and after their items settle; they
  // only fold away once formal text output starts after the group.
  useEffect(() => {
    if (shouldCollapse) {
      setExpanded(false);
    }
  }, [shouldCollapse]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-2 text-left text-app-13 leading-6 text-muted transition hover:text-fg"
        aria-expanded={expanded}
      >
        <ChevronRight className={`h-4 w-4 shrink-0 transition ${expanded ? "rotate-90" : ""}`} />
        <span>{formatKimiActivityGroupLabel(group.items, { active: isActive })}</span>
      </button>
      {expanded ? (
        <div className="mt-2 flex flex-col gap-3 border-l border-border pl-5">
          {group.items.map((item) => renderKimiTimelineItem(item, onSelectSubagent))}
        </div>
      ) : null}
    </div>
  );
}

export function getAssistantMessagePresentation(
  parts: MessagePart[],
  runStatus: Message["runStatus"],
): {
  timelineItems?: KimiTimelinePresentationItem[];
  activityItems: AgentActivityItem[];
  answerText: string;
  postAnswerActivityItems: AgentActivityItem[];
} {
  const kimiItems = parts
    .filter(
      (part): part is Extract<MessagePart, { type: "kimi_timeline" }> =>
        part.type === "kimi_timeline",
    )
    .map((part) => part.item)
    .sort((left, right) => left.order - right.order);
  if (kimiItems.length > 0) {
    const subagentTasks = new Map(
      parts.flatMap((part) => (part.type === "subagent_task" ? [[part.id, part] as const] : [])),
    );
    const timelineItems: KimiTimelinePresentationItem[] = kimiItems.map((item) => {
      if (item.type === "thinking") {
        return {
          type: "kimi-thinking",
          id: item.id,
          content: item.content,
          status: item.status,
        };
      }

      if (item.type === "message") {
        return { type: "text", id: item.id, content: item.content };
      }

      const subagentTask = subagentTasks.get(item.toolCallId);
      if (subagentTask) {
        return { type: "kimi-subagent", task: subagentTask };
      }

      return {
        type: "kimi-tool",
        id: item.id,
        title: item.title,
        kind: item.kind,
        command: item.command,
        filePath: item.filePath,
        input: item.input,
        output: item.output,
        error: item.error,
        status: item.status,
      };
    });

    return {
      timelineItems,
      activityItems: [],
      answerText: "",
      postAnswerActivityItems: [],
    };
  }

  const hasPlanReview = parts.some((part) => part.type === "plan_review");
  const answerCanStart = runStatus !== "running" || hasPlanReview;
  const lastActivityIndex = parts.reduce(
    (lastIndex, part, index) =>
      part.type === "reasoning" || part.type === "shell" ? index : lastIndex,
    -1,
  );
  const finalTextIndexes = new Set<number>();

  if (answerCanStart) {
    parts.forEach((part, index) => {
      if (part.type === "text" && index > lastActivityIndex) {
        finalTextIndexes.add(index);
      }
    });
  }

  const activityItems: AgentActivityItem[] = [];
  const answerParts: string[] = [];

  parts.forEach((part, index) => {
    if (part.type === "text") {
      if (finalTextIndexes.has(index)) {
        answerParts.push(part.content);
      } else if (part.content) {
        activityItems.push({
          type: "commentary",
          id: `commentary-${index}`,
          content: part.content,
        });
      }
      return;
    }

    // Subagent Tasks live in the Thread inspector pane; they never appear in
    // the chronological activity trail or the final answer text.
    if (part.type === "subagent_task") {
      return;
    }

    if ((part.type === "reasoning" || part.type === "shell") && !isRawThoughtPart(part)) {
      activityItems.push(part);
    }
  });

  return {
    activityItems,
    answerText: answerParts.join("\n"),
    postAnswerActivityItems: [],
  };
}

// Memoized on message identity: Run updates replace only the active message
// record, so completed history skips re-rendering (and Markdown re-parsing)
// for every streamed delta.
const AssistantMessage = memo(function AssistantMessage({
  message,
  timestamp,
  onRemoveRuntimeSessionAndRetry,
  onSelectSubagent,
}: {
  message: Message;
  timestamp: string;
  onRemoveRuntimeSessionAndRetry?: (request: RuntimeSessionRetryRequest) => Promise<void> | void;
  onSelectSubagent?: (taskId: string) => void;
}) {
  const content = message.content ?? "";
  const parts = message.type !== "changed_files" ? message.parts : undefined;
  const hasParts = !!parts?.length;
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const textParts = parts?.filter((part) => part.type === "text") ?? [];
  const planReviewParts = parts?.filter((part) => part.type === "plan_review") ?? [];
  // Pending questions already have the live Composer panel; only settled or
  // interrupted records render in the timeline.
  const questionParts =
    parts?.filter(
      (part): part is Extract<MessagePart, { type: "question" }> =>
        part.type === "question" && part.status !== "pending",
    ) ?? [];
  const errorParts =
    parts?.filter(
      (part): part is Extract<MessagePart, { type: "error" }> => part.type === "error",
    ) ?? [];
  const presentation = parts
    ? getAssistantMessagePresentation(parts, message.runStatus)
    : { activityItems: [], answerText: content, postAnswerActivityItems: [] };
  const hasKimiTimeline = !!presentation.timelineItems;
  const isStreaming =
    (!hasKimiTimeline && !hasParts && content === "" && !message.runStatus) ||
    (message.runStatus === "running" &&
      !hasKimiTimeline &&
      presentation.activityItems.length === 0 &&
      !presentation.answerText &&
      planReviewParts.length === 0 &&
      questionParts.length === 0);

  const copyText =
    presentation.answerText || textParts.map((part) => part.content).join("\n") || content;
  const kimiDisplayItems = hasKimiTimeline
    ? groupKimiTimelineItems(presentation.timelineItems!)
    : [];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="flex flex-col gap-3"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isStreaming ? (
        <AgentActivityBlock
          items={[]}
          status="running"
          startedAt={
            typeof message.createdAt === "string"
              ? Date.parse(message.createdAt)
              : message.createdAt
          }
          finishedAt={message.runFinishedAt}
          duration={message.duration}
        />
      ) : hasKimiTimeline ? (
        <div data-kimi-timeline className="flex flex-col gap-4">
          <AgentActivityBlock
            items={[]}
            status={message.runStatus}
            collapsible={false}
            startedAt={
              typeof message.createdAt === "string"
                ? Date.parse(message.createdAt)
                : message.createdAt
            }
            finishedAt={message.runFinishedAt}
            duration={message.duration}
          />
          {kimiDisplayItems.map((item, index) =>
            item.type === "kimi-activity-group" ? (
              <KimiActivityGroup
                key={item.id}
                group={item}
                hasFollowingText={kimiDisplayItems
                  .slice(index + 1)
                  .some((later) => later.type === "text")}
                onSelectSubagent={onSelectSubagent}
              />
            ) : (
              renderKimiTimelineItem(item, onSelectSubagent)
            ),
          )}
          {planReviewParts.map((review) => (
            <PlanReviewBlock key={review.id} review={review} />
          ))}
          {questionParts.map((part) => (
            <QuestionBlock key={part.id} part={part} />
          ))}
          {errorParts.map((part) => (
            <ErrorBlock
              key={part.id}
              part={part}
              onRemoveRuntimeSessionAndRetry={
                part.runtimeSessionRecovery && onRemoveRuntimeSessionAndRetry
                  ? () => onRemoveRuntimeSessionAndRetry(part.runtimeSessionRecovery!)
                  : undefined
              }
            />
          ))}
        </div>
      ) : hasParts ? (
        <div className="flex flex-col gap-4">
          {presentation.activityItems.length > 0 && (
            <AgentActivityBlock
              items={presentation.activityItems}
              status={message.runStatus}
              startedAt={
                typeof message.createdAt === "string"
                  ? Date.parse(message.createdAt)
                  : message.createdAt
              }
              finishedAt={message.runFinishedAt}
              duration={message.duration}
              hasFinalAnswerStarted={presentation.answerText.length > 0}
            />
          )}
          {planReviewParts.map((review) => (
            <PlanReviewBlock key={review.id} review={review} />
          ))}
          {questionParts.map((part) => (
            <QuestionBlock key={part.id} part={part} />
          ))}
          {presentation.answerText && <MarkdownContent>{presentation.answerText}</MarkdownContent>}
          {presentation.postAnswerActivityItems.length > 0 && (
            <AgentActivityList items={presentation.postAnswerActivityItems} className="py-1" />
          )}
          {errorParts.map((part) => (
            <ErrorBlock
              key={part.id}
              part={part}
              onRemoveRuntimeSessionAndRetry={
                part.runtimeSessionRecovery && onRemoveRuntimeSessionAndRetry
                  ? () => onRemoveRuntimeSessionAndRetry(part.runtimeSessionRecovery!)
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <MarkdownContent>{content}</MarkdownContent>
      )}
      {message.runStatus === "cancelled" &&
      !hasKimiTimeline &&
      !(hasParts && presentation.activityItems.length > 0) ? (
        <div className="flex items-center gap-1.5 text-app-12 text-subtle">
          <XCircle className="h-3.5 w-3.5" />
          <span>Stopped</span>
        </div>
      ) : null}
      <div className="flex items-center gap-2 opacity-70">
        <span className="text-app-11 text-subtle">{timestamp}</span>
        {hovered && (
          <button
            onClick={handleCopy}
            className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:text-muted"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
});

const ChangedFilesMessageItem = memo(function ChangedFilesMessageItem({
  message,
  timestamp,
}: {
  message: Extract<Message, { type: "changed_files" }>;
  timestamp: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const content = message.content ?? "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="flex flex-col gap-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ChangedFilesCard message={message} />
      <div className="flex items-center gap-2">
        <span className="text-app-11 text-subtle">{timestamp}</span>
        {hovered && (
          <button
            onClick={handleCopy}
            className="flex h-5 w-5 items-center justify-center rounded text-subtle transition hover:text-muted"
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  );
});

export function EmptyThreadPrompt({ projectName }: { projectName?: string }) {
  return (
    <p data-empty-thread-prompt className="text-center text-app-22 font-semibold leading-tight">
      <span className={projectName ? "text-muted" : "text-fg"}>What should we build</span>
      {projectName && (
        <>
          <span className="text-muted"> in </span>
          <span className="text-fg">{projectName}</span>
        </>
      )}
      <span className={projectName ? "text-muted" : "text-fg"}>?</span>
    </p>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <EmptyThreadPrompt />
    </div>
  );
}

export function MessageTimeline({
  messages,
  threadActions = [],
  threadId,
  onSubmitUserEdit,
  onRemoveRuntimeSessionAndRetry,
  onSelectSubagent,
}: {
  messages: Message[];
  threadActions?: AppThreadActionRecord[];
  threadId?: string;
  onSubmitUserEdit?: (draft: UserMessageEditDraft) => void;
  onRemoveRuntimeSessionAndRetry?: (request: RuntimeSessionRetryRequest) => Promise<void> | void;
  onSelectSubagent?: (taskId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const initialScrollThreadRef = useRef<string | null>(null);
  const latestUserMessageRef = useRef<{ threadId: string; messageId: string | null } | null>(null);
  let latestUserMessageId: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      latestUserMessageId = messages[index].id;
      break;
    }
  }

  // Entering a thread pins the view to the latest message. Without this the
  // scroll container starts at the top and the near-bottom effect below can
  // never engage, forcing a manual scroll through the whole history.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || threadId === undefined || messages.length === 0) return;
    if (initialScrollThreadRef.current === threadId) return;
    initialScrollThreadRef.current = threadId;
    latestUserMessageRef.current = { threadId, messageId: latestUserMessageId };
    el.scrollTo({ top: el.scrollHeight });
  }, [threadId, messages, latestUserMessageId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || threadId === undefined) return;
    const previous = latestUserMessageRef.current;
    latestUserMessageRef.current = { threadId, messageId: latestUserMessageId };
    if (
      previous?.threadId === threadId &&
      latestUserMessageId !== null &&
      previous.messageId !== latestUserMessageId
    ) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [threadId, latestUserMessageId]);

  useEffect(() => {
    if (editingMessageId && !messages.some((message) => message.id === editingMessageId)) {
      setEditingMessageId(null);
    }
  }, [editingMessageId, messages]);

  useEffect(() => {
    if (!onSubmitUserEdit) {
      setEditingMessageId(null);
    }
  }, [onSubmitUserEdit]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      setShowScrollButton(distanceToBottom(el) > NEAR_BOTTOM_THRESHOLD);
    };

    el.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Streaming updates follow the bottom at most once per animation frame and
  // snap instantly: restarting a smooth animation on every delta makes the
  // view bounce. The near-bottom check runs when the frame fires, so a user
  // who scrolled up in the meantime is left alone.
  const followFrameRef = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || followFrameRef.current !== null) return;
    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = null;
      if (distanceToBottom(el) < NEAR_BOTTOM_THRESHOLD) {
        el.scrollTo({ top: el.scrollHeight });
      }
    });
  }, [messages, threadActions]);

  useEffect(
    () => () => {
      if (followFrameRef.current !== null) {
        cancelAnimationFrame(followFrameRef.current);
      }
    },
    [],
  );

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  const timelineItems = [
    ...messages.map((message) => ({ kind: "message" as const, at: message.createdAt, message })),
    ...threadActions.map((action) => ({
      kind: "thread-action" as const,
      at: action.completedAt,
      action,
    })),
  ].sort((left, right) => {
    const leftAt = typeof left.at === "number" ? left.at : Date.parse(left.at ?? "");
    const rightAt = typeof right.at === "number" ? right.at : Date.parse(right.at ?? "");
    return (Number.isFinite(leftAt) ? leftAt : 0) - (Number.isFinite(rightAt) ? rightAt : 0);
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex flex-1 flex-col overflow-auto">
        {timelineItems.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex w-full max-w-[56rem] flex-col pb-4">
            {timelineItems.map((item) => {
              if (item.kind === "thread-action") {
                return (
                  <div
                    key={item.action.id}
                    className="flex items-center gap-3 px-6 py-4 text-app-12 text-subtle"
                  >
                    <span className="h-px flex-1 bg-border" />
                    <span>Context compacted</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                );
              }
              const msg = item.message;
              if (msg.role === "user") {
                const editDraft = getUserMessageEditDraft(msg);
                return (
                  <div key={msg.id} className="px-6 py-4">
                    <UserMessage
                      content={msg.content}
                      timestamp={getMessageTimestamp(msg)}
                      attachments={msg.attachments}
                      localPathContexts={msg.localPathContexts}
                      isEditing={editingMessageId === msg.id}
                      onEdit={
                        editDraft && onSubmitUserEdit
                          ? () => setEditingMessageId(msg.id)
                          : undefined
                      }
                      onCancelEdit={() => setEditingMessageId(null)}
                      onSubmitEdit={(content, localPathContexts) => {
                        onSubmitUserEdit?.({
                          messageId: msg.id,
                          content,
                          attachments: msg.attachments,
                          localPathContexts,
                        });
                        setEditingMessageId(null);
                      }}
                    />
                  </div>
                );
              }

              if (msg.type === "changed_files") {
                return (
                  <div key={msg.id} className="px-4 py-5">
                    <ChangedFilesMessageItem message={msg} timestamp={getMessageTimestamp(msg)} />
                  </div>
                );
              }

              return (
                <div key={msg.id} className="px-6 py-4">
                  <AssistantMessage
                    message={msg}
                    timestamp={getMessageTimestamp(msg)}
                    onRemoveRuntimeSessionAndRetry={onRemoveRuntimeSessionAndRetry}
                    onSelectSubagent={onSelectSubagent}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          className="absolute bottom-4 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-muted shadow-lg transition hover:border-border-strong hover:bg-surface-hover hover:text-fg"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
