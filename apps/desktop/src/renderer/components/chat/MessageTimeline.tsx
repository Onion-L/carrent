import { ArrowDown, Box, Check, Copy, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Message,
  type MessagePart,
  type ImageAttachmentMetadata,
} from "../../mock/uiShellData";
import { AgentActivityBlock, type AgentActivityItem } from "./AgentActivityBlock";
import { ChangedFilesCard } from "./ChangedFilesCard";
import { ImageAttachmentLightbox, type StoredLightboxItem } from "./ImageAttachmentLightbox";
import { MarkdownContent } from "./MarkdownContent";
import { PlanReviewBlock } from "./PlanReviewBlock";

type UserMessageSegment =
  | { type: "text"; content: string }
  | { type: "skill"; name: string; path: string };

export type UserMessageEditDraft = {
  messageId: string;
  content: string;
  attachments?: ImageAttachmentMetadata[];
};

const SKILL_REFERENCE_PATTERN = /\[\$([^\]\n]+)\]\(([^)\n]+\/SKILL\.md)\)/gu;
const LEADING_SKILL_REFERENCE_PATTERN = /^\s*(\[\$([^\]\n]+)\]\(([^)\n]+\/SKILL\.md)\))\s*/u;

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
  if (message.role !== "user" || !message.content.trim()) {
    return null;
  }

  return {
    messageId: message.id,
    content: message.content,
    attachments: message.attachments,
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
      className="inline-flex max-w-full items-center gap-2 rounded-full bg-black/25 px-3 py-1 align-middle font-medium text-[#82bdff]"
    >
      <Box className="h-4 w-4 shrink-0" strokeWidth={2} />
      <span className="truncate">${name}</span>
    </span>
  );
}

function UserMessageContent({ content }: { content: string }) {
  return (
    <p className="whitespace-pre-wrap text-app-14 leading-relaxed text-user-bubble-fg">
      {parseSkillReferenceSegments(content).map((segment, index) => {
        if (segment.type === "text") {
          return <span key={`${index}-text`}>{segment.content}</span>;
        }

        return (
          <SkillBadge key={`${index}-${segment.name}`} name={segment.name} path={segment.path} />
        );
      })}
    </p>
  );
}

function StoredAttachmentThumbnail({
  attachment,
  onClick,
}: {
  attachment: ImageAttachmentMetadata;
  onClick: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    window.carrent.attachments
      .read(attachment.storageKey)
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
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface text-app-11 text-muted">
        {failed ? "Missing" : "..."}
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
      <img src={url} alt={attachment.name} className="h-16 w-16 object-cover" />
    </button>
  );
}

function UserMessage({
  content,
  timestamp,
  attachments,
  isEditing,
  onEdit,
  onCancelEdit,
  onSubmitEdit,
}: {
  content: string;
  timestamp: string;
  attachments?: ImageAttachmentMetadata[];
  isEditing?: boolean;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: (content: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const editState = useMemo(() => splitLeadingSkillReferences(content), [content]);
  const [draftBody, setDraftBody] = useState(editState.body);

  useEffect(() => {
    if (isEditing) {
      setDraftBody(editState.body);
    }
  }, [editState.body, isEditing]);

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
    attachments?.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      storageKey: attachment.storageKey,
      mimeType: attachment.mimeType,
    })) ?? [];
  const editedContent = buildUserMessageEditContent(editState.prefix, draftBody);
  const canSubmitEdit = !!editedContent.trim();

  const handleSubmitEdit = () => {
    if (!canSubmitEdit) return;
    onSubmitEdit?.(editedContent);
  };

  if (isEditing) {
    return (
      <div className="relative flex justify-end">
        <div className="w-full max-w-[80%] rounded-2xl rounded-tr-sm bg-user-bubble px-4 py-3">
          <div className="flex min-h-20 flex-wrap items-start gap-2">
            {editState.skills.map((skill) => (
              <SkillBadge key={skill.path} name={skill.name} path={skill.path} />
            ))}
            <textarea
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
              className="min-h-16 min-w-[14rem] flex-1 resize-none bg-transparent text-app-15 leading-6 text-user-bubble-fg outline-none placeholder:text-subtle"
              autoFocus
            />
          </div>
          {attachments && attachments.length > 0 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {attachments.map((attachment, index) => (
                <StoredAttachmentThumbnail
                  key={attachment.id}
                  attachment={attachment}
                  onClick={() => setLightboxIndex(index)}
                />
              ))}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-full border border-white/10 px-4 py-2 text-app-15 font-semibold text-user-bubble-fg transition hover:bg-white/5"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmitEdit}
              disabled={!canSubmitEdit}
              className="rounded-full bg-white px-4 py-2 text-app-15 font-semibold text-black transition hover:bg-white/90 disabled:opacity-40"
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
        <div className="rounded-2xl rounded-tr-sm bg-user-bubble px-4 py-3">
          {content && <UserMessageContent content={content} />}
          {attachments && attachments.length > 0 && (
            <div className={`flex gap-2 overflow-x-auto ${content ? "mt-2" : ""}`}>
              {attachments.map((attachment, index) => (
                <StoredAttachmentThumbnail
                  key={attachment.id}
                  attachment={attachment}
                  onClick={() => setLightboxIndex(index)}
                />
              ))}
            </div>
          )}
        </div>
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

function isRawThoughtPart(part: ActivityPart) {
  return part.type === "reasoning" && part.id.startsWith("kimi-thinking-");
}

export function getAssistantMessagePresentation(
  parts: MessagePart[],
  runStatus: Message["runStatus"],
) {
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

    if ((part.type === "reasoning" || part.type === "shell") && !isRawThoughtPart(part)) {
      activityItems.push(part);
    }
  });

  return {
    activityItems,
    answerText: answerParts.join("\n"),
  };
}

function AssistantMessage({ message, timestamp }: { message: Message; timestamp: string }) {
  const content = message.content ?? "";
  const parts = message.type !== "changed_files" ? message.parts : undefined;
  const hasParts = !!parts?.length;
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const textParts = parts?.filter((part) => part.type === "text") ?? [];
  const planReviewParts = parts?.filter((part) => part.type === "plan_review") ?? [];
  const presentation = parts
    ? getAssistantMessagePresentation(parts, message.runStatus)
    : { activityItems: [], answerText: content };
  const isStreaming =
    (!hasParts && content === "") ||
    (message.runStatus === "running" &&
      presentation.activityItems.length === 0 &&
      !presentation.answerText &&
      planReviewParts.length === 0);

  const copyText =
    presentation.answerText || textParts.map((part) => part.content).join("\n") || content;

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
        <div className="flex items-center py-1">
          {"Thinking".split("").map((char, i) => (
            <span
              key={i}
              className="inline-block animate-pulse text-app-13 text-subtle"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              {char}
            </span>
          ))}
        </div>
      ) : hasParts ? (
        <div className="flex flex-col gap-4">
          {presentation.activityItems.length > 0 && (
            <AgentActivityBlock
              items={presentation.activityItems}
              status={message.runStatus}
              startedAt={message.createdAt}
              finishedAt={message.runFinishedAt}
              duration={message.duration}
              hasFinalAnswerStarted={presentation.answerText.length > 0}
            />
          )}
          {planReviewParts.map((review) => (
            <PlanReviewBlock key={review.id} review={review} />
          ))}
          {presentation.answerText && <MarkdownContent>{presentation.answerText}</MarkdownContent>}
        </div>
      ) : (
        <MarkdownContent>{content}</MarkdownContent>
      )}
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
}

function ChangedFilesMessageItem({
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
}

export function EmptyThreadPrompt() {
  return (
    <p className="text-center text-app-32 font-semibold leading-tight text-fg sm:text-app-36">
      What should we build?
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
  onSubmitUserEdit,
}: {
  messages: Message[];
  onSubmitUserEdit?: (draft: UserMessageEditDraft) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

  useEffect(() => {
    if (editingMessageId && !messages.some((message) => message.id === editingMessageId)) {
      setEditingMessageId(null);
    }
  }, [editingMessageId, messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const threshold = 80;
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollButton(distanceToBottom > threshold);
    };

    el.addEventListener("scroll", handleScroll);
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 80;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < threshold) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex flex-1 flex-col overflow-auto">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex w-full max-w-[56rem] flex-col pb-4">
            {messages.map((msg) => {
              if (msg.role === "user") {
                const editDraft = getUserMessageEditDraft(msg);
                return (
                  <div key={msg.id} className="px-6 py-4">
                    <UserMessage
                      content={msg.content}
                      timestamp={msg.timestamp}
                      attachments={msg.attachments}
                      isEditing={editingMessageId === msg.id}
                      onEdit={
                        editDraft && onSubmitUserEdit
                          ? () => setEditingMessageId(msg.id)
                          : undefined
                      }
                      onCancelEdit={() => setEditingMessageId(null)}
                      onSubmitEdit={(content) => {
                        onSubmitUserEdit?.({
                          messageId: msg.id,
                          content,
                          attachments: msg.attachments,
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
                    <ChangedFilesMessageItem message={msg} timestamp={msg.timestamp} />
                  </div>
                );
              }

              return (
                <div key={msg.id} className="px-6 py-4">
                  <AssistantMessage message={msg} timestamp={msg.timestamp} />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border-strong bg-surface-raised text-muted shadow-lg transition hover:border-border-strong hover:bg-surface-hover hover:text-fg"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
