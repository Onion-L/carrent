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
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type Message,
  type MessagePart,
  type AttachmentMetadata,
  type SubagentTaskPart,
} from "../../../shared/threadContent";
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
import { MarkdownContent, type MarkdownLinkRender } from "./MarkdownContent";
import { QuestionBlock } from "./QuestionBlock";
import { parseFileReferenceSegments } from "./fileReferences";
import { formatSkillLabel } from "./skillLabel";
import { useRevealLocalPathContext } from "../../hooks/useRevealLocalPathContext";

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
    <span title={path} className="font-medium text-skill-reference">
      <Box className="mr-1.5 inline-block h-4 w-4 align-middle" strokeWidth={2} />
      {formatSkillLabel(name)}
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
        void window.carrent.shell.revealPath(filePath);
      }}
      className="inline-flex max-w-full items-center gap-1 align-middle text-skill-reference hover:underline"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <span className="break-all">{label}</span>
    </button>
  );
}

function markdownChildrenToText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(markdownChildrenToText).join("");
  return "";
}

function isSafeExternalMarkdownUrl(href: string) {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const renderUserMarkdownLink: MarkdownLinkRender = ({ children, href }) => {
  if (href === undefined) return <span>{children}</span>;

  const label = markdownChildrenToText(children);
  if (href.endsWith("/SKILL.md") && label.startsWith("$")) {
    return <SkillBadge name={label.slice(1)} path={href} />;
  }

  if (href.startsWith("/") && !href.startsWith("//")) {
    return <FileReferenceBadge label={label || href} path={href} />;
  }

  if (!isSafeExternalMarkdownUrl(href)) return <span>{children}</span>;
  return undefined;
};

function handleUserMarkdownLink(href: string) {
  if (!isSafeExternalMarkdownUrl(href)) return true;
  void window.carrent.shell.openExternal(href);
  return true;
}

function UserMessageContent({ content }: { content: string }) {
  return (
    <MarkdownContent
      variant="user"
      renderLink={renderUserMarkdownLink}
      onLinkClick={handleUserMarkdownLink}
    >
      {content}
    </MarkdownContent>
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
  const revealLocalPath = useRevealLocalPathContext();

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <button
          key={`${item.kind}:${item.path}`}
          type="button"
          data-local-path-context-badge
          title={item.path}
          aria-label={`Reveal ${item.basename} in Finder`}
          onClick={() => void revealLocalPath(item)}
          className="inline-flex min-h-8 max-w-full items-center gap-2 rounded-md border border-border-strong bg-bg/45 px-2.5 text-app-12 text-fg outline-none transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-fg/25"
        >
          {item.kind === "directory" ? (
            <Folder className="h-4 w-4 shrink-0 text-muted" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-muted" />
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

export type AgentTimelinePresentationItem =
  | Extract<AgentActivityItem, { type: "agent-thinking" | "agent-tool" }>
  | { type: "text"; id: string; content: string }
  | { type: "agent-subagent"; task: SubagentTaskPart };

function AgentSubagentItem({
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

export type AgentTimelineGroupableItem = Extract<
  AgentTimelinePresentationItem,
  { type: "agent-thinking" | "agent-tool" | "agent-subagent" }
>;

export type AgentTimelineActivityGroup = {
  type: "agent-activity-group";
  id: string;
  items: AgentTimelineGroupableItem[];
};

export type AgentTimelineDisplayItem = AgentTimelinePresentationItem | AgentTimelineActivityGroup;

function agentTimelineItemId(item: AgentTimelineGroupableItem) {
  return item.type === "agent-subagent" ? item.task.id : item.id;
}

// Collapses runs of consecutive thinking/tool/subagent entries into a single
// expandable group. Text messages break a run, so the visible order of events
// is never changed. Runs of a single item stay inline.
export function groupAgentTimelineItems(
  items: AgentTimelinePresentationItem[],
): AgentTimelineDisplayItem[] {
  const result: AgentTimelineDisplayItem[] = [];
  let buffer: AgentTimelineGroupableItem[] = [];

  const flush = () => {
    if (buffer.length >= 2) {
      result.push({
        type: "agent-activity-group",
        id: `agent-activity-group-${agentTimelineItemId(buffer[0]!)}`,
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

export function formatAgentActivityGroupLabel(
  items: AgentTimelineGroupableItem[],
  { active = false }: { active?: boolean } = {},
) {
  const thoughts = items.filter((item) => item.type === "agent-thinking").length;
  const tools = items.filter((item) => item.type === "agent-tool").length;
  const subagents = items.length - thoughts - tools;
  const parts: string[] = [];
  if (tools > 0) parts.push(`${tools} tool call${tools === 1 ? "" : "s"}`);
  if (thoughts > 0) parts.push(`${thoughts} thought${thoughts === 1 ? "" : "s"}`);
  if (subagents > 0) parts.push(`${subagents} subagent${subagents === 1 ? "" : "s"}`);
  return `${active ? "Running" : "Ran"} ${parts.join(" · ")}`;
}

function isAgentTimelineItemActive(item: AgentTimelineGroupableItem) {
  if (item.type === "agent-subagent") {
    return item.task.status === "running";
  }
  if (item.status === "running") {
    return true;
  }
  return item.type === "agent-tool" && item.status === "pending";
}

function renderAgentTimelineItem(
  item: AgentTimelinePresentationItem,
  onSelectSubagent?: (taskId: string) => void,
) {
  if (item.type === "text") {
    return <MarkdownContent key={item.id}>{item.content}</MarkdownContent>;
  }
  if (item.type === "agent-thinking" || item.type === "agent-tool") {
    return <AgentActivityList key={item.id} items={[item]} />;
  }
  return <AgentSubagentItem key={item.task.id} task={item.task} onSelect={onSelectSubagent} />;
}

function AgentActivityGroup({
  group,
  hasFollowingText,
  onSelectSubagent,
}: {
  group: AgentTimelineActivityGroup;
  hasFollowingText: boolean;
  onSelectSubagent?: (taskId: string) => void;
}) {
  const isActive = group.items.some(isAgentTimelineItemActive);
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
        <span>{formatAgentActivityGroupLabel(group.items, { active: isActive })}</span>
      </button>
      {expanded ? (
        <div className="mt-2 flex flex-col gap-3 border-l border-border pl-5">
          {group.items.map((item) => renderAgentTimelineItem(item, onSelectSubagent))}
        </div>
      ) : null}
    </div>
  );
}

export function getAssistantMessagePresentation(
  parts: MessagePart[],
  _runStatus: Message["runStatus"],
): {
  timelineItems?: AgentTimelinePresentationItem[];
  activityItems: AgentActivityItem[];
  answerText: string;
  postAnswerActivityItems: AgentActivityItem[];
} {
  const agentItems = parts
    .filter(
      (part): part is Extract<MessagePart, { type: "agent_activity" }> =>
        part.type === "agent_activity",
    )
    .map((part) => part.item)
    .sort((left, right) => left.order - right.order);
  if (agentItems.length > 0) {
    const subagentTasks = new Map(
      parts.flatMap((part) => (part.type === "subagent_task" ? [[part.id, part] as const] : [])),
    );
    const timelineItems: AgentTimelinePresentationItem[] = agentItems.map((item) => {
      if (item.type === "thinking") {
        return {
          type: "agent-thinking",
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
        return { type: "agent-subagent", task: subagentTask };
      }

      return {
        type: "agent-tool",
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

    // Agent activity is stored separately from streamed text. Once the run
    // settles, text parts after the final activity item are the formal answer
    // and must be rendered after the activity timeline.
    const lastActivityIndex = parts.reduce(
      (lastIndex, part, index) =>
        part.type === "agent_activity" || part.type === "reasoning" || part.type === "shell"
          ? index
          : lastIndex,
      -1,
    );
    const answerText = parts
      .filter(
        (part, index): part is Extract<MessagePart, { type: "text" }> =>
          part.type === "text" && index > lastActivityIndex,
      )
      .map((part) => part.content)
      .join("\n");

    return {
      timelineItems,
      activityItems: [],
      answerText,
      postAnswerActivityItems: [],
    };
  }

  const lastActivityIndex = parts.reduce(
    (lastIndex, part, index) =>
      part.type === "reasoning" || part.type === "shell" ? index : lastIndex,
    -1,
  );
  const finalTextIndexes = new Set<number>();

  parts.forEach((part, index) => {
    if (part.type === "text" && index > lastActivityIndex) {
      finalTextIndexes.add(index);
    }
  });

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

    if (part.type === "reasoning" || part.type === "shell") {
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
  onSelectSubagent,
}: {
  message: Message;
  timestamp: string;
  onSelectSubagent?: (taskId: string) => void;
}) {
  const content = message.content ?? "";
  const parts = message.type !== "changed_files" ? message.parts : undefined;
  const hasParts = !!parts?.length;
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const textParts = parts?.filter((part) => part.type === "text") ?? [];
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
  const hasAgentTimeline = !!presentation.timelineItems;
  const isStreaming =
    (!hasAgentTimeline && !hasParts && content === "" && !message.runStatus) ||
    (message.runStatus === "running" &&
      !hasAgentTimeline &&
      presentation.activityItems.length === 0 &&
      !presentation.answerText &&
      questionParts.length === 0);

  const copyText =
    presentation.answerText || textParts.map((part) => part.content).join("\n") || content;
  const agentDisplayItems = hasAgentTimeline
    ? groupAgentTimelineItems(presentation.timelineItems!)
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
      ) : hasAgentTimeline ? (
        <div data-agent-timeline className="flex flex-col gap-4">
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
          {agentDisplayItems.map((item, index) =>
            item.type === "agent-activity-group" ? (
              <AgentActivityGroup
                key={item.id}
                group={item}
                hasFollowingText={agentDisplayItems
                  .slice(index + 1)
                  .some((later) => later.type === "text")}
                onSelectSubagent={onSelectSubagent}
              />
            ) : (
              renderAgentTimelineItem(item, onSelectSubagent)
            ),
          )}
          {presentation.answerText && <MarkdownContent>{presentation.answerText}</MarkdownContent>}
          {questionParts.map((part) => (
            <QuestionBlock key={part.id} part={part} />
          ))}
          {errorParts.map((part) => (
            <ErrorBlock key={part.id} part={part} />
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
          {questionParts.map((part) => (
            <QuestionBlock key={part.id} part={part} />
          ))}
          {presentation.answerText && <MarkdownContent>{presentation.answerText}</MarkdownContent>}
          {presentation.postAnswerActivityItems.length > 0 && (
            <AgentActivityList items={presentation.postAnswerActivityItems} className="py-1" />
          )}
          {errorParts.map((part) => (
            <ErrorBlock key={part.id} part={part} />
          ))}
        </div>
      ) : (
        <MarkdownContent>{content}</MarkdownContent>
      )}
      {message.runStatus === "cancelled" &&
      !hasAgentTimeline &&
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
  threadId,
  onSubmitUserEdit,
  onSelectSubagent,
}: {
  messages: Message[];
  threadId?: string;
  onSubmitUserEdit?: (draft: UserMessageEditDraft) => void;
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
  }, [messages]);

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

  const timelineItems = messages
    .map((message) => ({
      at: message.createdAt,
      message,
    }))
    .sort((left, right) => {
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
