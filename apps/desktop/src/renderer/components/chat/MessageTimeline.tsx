import { ArrowDown, Check, Copy, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Message, type MessagePart, type ImageAttachmentMetadata } from "../../mock/uiShellData";
import { ChangedFilesCard } from "./ChangedFilesCard";
import { ReasoningBlock } from "./ReasoningBlock";
import { ShellBlock } from "./ShellBlock";
import { ImageAttachmentLightbox, type StoredLightboxItem } from "./ImageAttachmentLightbox";

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
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface text-[11px] text-muted">
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
}: {
  content: string;
  timestamp: string;
  attachments?: ImageAttachmentMetadata[];
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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
    })) ?? [];

  return (
    <div
      className="relative flex justify-end"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="max-w-[80%]">
        <div className="rounded-2xl rounded-tr-sm bg-user-bubble px-4 py-3">
          {content && (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-user-bubble-fg">
              {content}
            </p>
          )}
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
          <span className="text-[12px] text-subtle">{timestamp}</span>
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-subtle transition hover:text-muted"
            title="Retry"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            className="flex h-6 w-6 items-center justify-center rounded text-subtle transition hover:text-muted"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
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

type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;

function AssistantMessage({ message, timestamp }: { message: Message; timestamp: string }) {
  const content = message.content ?? "";
  const parts = message.type !== "changed_files" ? message.parts : undefined;
  const hasParts = !!parts?.length;
  const isStreaming = !hasParts && content === "";
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const reasoningParts =
    parts?.filter((part): part is ReasoningPart => part.type === "reasoning") ?? [];
  const nonReasoningParts = parts?.filter((part) => part.type !== "reasoning") ?? [];

  const copyText = hasParts
    ? (parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.content)
        .join("\n") ?? content)
    : content;

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
              className="inline-block animate-pulse text-[13px] text-subtle"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              {char}
            </span>
          ))}
        </div>
      ) : hasParts ? (
        <div className="flex flex-col gap-4">
          {reasoningParts.length > 0 && <ReasoningBlock reasoning={reasoningParts} />}
          {nonReasoningParts.map((part, index) =>
            part.type === "text" ? (
              part.content ? (
                <p
                  key={`${index}-text`}
                  className="whitespace-pre-wrap text-[15px] leading-7 text-fg"
                >
                  {part.content}
                </p>
              ) : null
            ) : (
              <ShellBlock key={part.id} shell={part} />
            ),
          )}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-[15px] leading-7 text-fg">{content}</p>
      )}
      <div className="flex items-center gap-2 opacity-70">
        <span className="text-[11px] text-subtle">{timestamp}</span>
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
        <span className="text-[11px] text-subtle">{timestamp}</span>
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

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <p className="text-[15px] text-subtle">What should we build?</p>
    </div>
  );
}

export function MessageTimeline({ messages }: { messages: Message[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

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
                return (
                  <div key={msg.id} className="px-6 py-4">
                    <UserMessage
                      content={msg.content}
                      timestamp={msg.timestamp}
                      attachments={msg.attachments}
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
