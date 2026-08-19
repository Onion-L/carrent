import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Database,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import type { RuntimeDebugRecord, RuntimeDebugTrace } from "../../../shared/runtimeDebug";
import type { Message } from "../../../shared/threadContent";

export type DebugBadge =
  | "SYSTEM"
  | "USER"
  | "CONTEXT"
  | "ASSISTANT"
  | "THOUGHT"
  | "TOOL CALL"
  | "TOOL RESULT"
  | "LLM"
  | "STEP"
  | "EVENT"
  | "ERROR";

export type DebugRow = {
  id: string;
  sequence: number;
  badge: DebugBadge;
  title: string;
  summary: string;
  raw: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  step?: number | string;
  turnId?: string;
  time?: number;
  final?: boolean;
};

type DebugView = "conversation" | "raw";
type DetailSourceTab = "raw" | "input" | "output";
type DetailTab = DetailSourceTab | "json";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type StructuredJsonResult = { ok: true; value: JsonValue } | { ok: false };

const BADGE_STYLES: Record<DebugBadge, string> = {
  SYSTEM: "border-debug-system/40 bg-debug-system/10 text-debug-system",
  USER: "border-debug-user/40 bg-debug-user/10 text-debug-user",
  CONTEXT: "border-debug-context/40 bg-debug-context/10 text-debug-context",
  ASSISTANT: "border-debug-assistant/40 bg-debug-assistant/10 text-debug-assistant",
  THOUGHT: "border-debug-thought/40 bg-debug-thought/10 text-debug-thought",
  "TOOL CALL": "border-debug-tool-call/40 bg-debug-tool-call/10 text-debug-tool-call",
  "TOOL RESULT": "border-debug-tool-result/40 bg-debug-tool-result/10 text-debug-tool-result",
  LLM: "border-debug-llm/40 bg-debug-llm/10 text-debug-llm",
  STEP: "border-debug-step/40 bg-debug-step/10 text-debug-step",
  EVENT: "border-debug-event/40 bg-debug-event/10 text-debug-event",
  ERROR: "border-debug-error/40 bg-debug-error/10 text-debug-error",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStep(value: unknown): number | string | undefined {
  return readNumber(value) ?? readString(value) ?? undefined;
}

function collapse(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncate(value: string, limit = 220): string {
  return value.length > limit ? value.slice(0, limit) + "…" : value;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function toStructuredJson(value: unknown): StructuredJsonResult {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return { ok: false };
    }
  }

  try {
    const serialized = JSON.stringify(candidate);
    if (serialized === undefined) return { ok: false };
    return { ok: true, value: JSON.parse(serialized) as JsonValue };
  } catch {
    return { ok: false };
  }
}

function jsonContainerSize(value: JsonValue[] | { [key: string]: JsonValue }) {
  return Array.isArray(value) ? value.length : Object.keys(value).length;
}

function jsonContainerSummary(value: JsonValue[] | { [key: string]: JsonValue }) {
  const size = jsonContainerSize(value);
  if (Array.isArray(value)) return size + (size === 1 ? " item" : " items");
  return size + (size === 1 ? " key" : " keys");
}

function JsonKey({ name, arrayItem }: { name: string; arrayItem: boolean }) {
  return (
    <span className="shrink-0 text-fg">
      {arrayItem ? "[" + name + "]" : JSON.stringify(name) + ":"}
    </span>
  );
}

function JsonPrimitiveValue({ value }: { value: Exclude<JsonValue, JsonValue[] | object> }) {
  if (value === null) return <span className="text-subtle">null</span>;
  if (typeof value === "string") {
    return (
      <span className="min-w-0 whitespace-pre-wrap break-words text-debug-tool-result">
        {JSON.stringify(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return <span className="text-debug-llm">{String(value)}</span>;
  }
  return <span className="text-debug-assistant">{String(value)}</span>;
}

function JsonTreeNode({
  value,
  name,
  path,
  depth,
  arrayItem = false,
}: {
  value: JsonValue;
  name?: string;
  path: string;
  depth: number;
  arrayItem?: boolean;
}) {
  const container = value !== null && typeof value === "object";
  const [expanded, setExpanded] = useState(depth < 2);
  const paddingLeft = depth * 16;

  if (!container) {
    return (
      <div className="flex min-w-0 items-start gap-2" style={{ paddingLeft }}>
        <span className="h-4 w-4 shrink-0" />
        {name === undefined ? null : <JsonKey name={name} arrayItem={arrayItem} />}
        <JsonPrimitiveValue value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  const opening = Array.isArray(value) ? "[" : "{";
  const closing = Array.isArray(value) ? "]" : "}";
  const empty = entries.length === 0;
  const label = (expanded ? "Collapse " : "Expand ") + "JSON " + path;

  return (
    <div>
      <button
        type="button"
        aria-expanded={empty ? undefined : expanded}
        aria-label={empty ? undefined : label}
        disabled={empty}
        onClick={() => setExpanded((current) => !current)}
        className="flex max-w-full items-center gap-1 rounded text-left text-muted hover:text-fg disabled:cursor-default disabled:text-muted"
        style={{ paddingLeft }}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {empty ? null : (
            <ChevronRight
              className={"h-3 w-3 transition-transform " + (expanded ? "rotate-90" : "")}
            />
          )}
        </span>
        {name === undefined ? null : <JsonKey name={name} arrayItem={arrayItem} />}
        <span>{empty ? opening + closing : opening}</span>
        {!empty && !expanded ? (
          <span className="text-subtle">{jsonContainerSummary(value)}</span>
        ) : null}
        {!empty && !expanded ? <span>{closing}</span> : null}
      </button>
      {!empty && expanded ? (
        <>
          {entries.map(([key, child]) => (
            <JsonTreeNode
              key={key}
              value={child}
              name={key}
              path={path + (Array.isArray(value) ? "[" + key + "]" : "." + key)}
              depth={depth + 1}
              arrayItem={Array.isArray(value)}
            />
          ))}
          <div className="text-muted" style={{ paddingLeft: paddingLeft + 20 }}>
            {closing}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function JsonTree({ value }: { value: JsonValue }) {
  return (
    <div aria-label="Structured JSON" className="font-mono text-app-11 leading-5">
      <JsonTreeNode value={value} path="root" depth={0} />
    </div>
  );
}

function summaryOf(value: unknown, fallback: string): string {
  const text = collapse(stringify(value));
  return truncate(text || fallback);
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textContent).filter(Boolean).join("");
  if (!isRecord(value)) return "";
  if (value.type === "text") return readString(value.text) ?? "";
  if (value.type === "content") return textContent(value.content);
  return readString(value.text) ?? readString(value.content) ?? "";
}

function rowBase(
  record: RuntimeDebugRecord,
  suffix: string,
): Pick<DebugRow, "id" | "sequence" | "raw" | "time"> {
  return {
    id: "wire:" + record.sequence + ":" + suffix,
    sequence: record.sequence,
    raw: record.raw,
    ...(record.time !== undefined ? { time: record.time } : {}),
  };
}

function loopEvent(record: RuntimeDebugRecord) {
  return isRecord(record.raw.event) ? record.raw.event : null;
}

function finalSteps(records: RuntimeDebugRecord[]) {
  const steps = new Set<number | string>();
  for (const record of records) {
    const event = loopEvent(record);
    const step = readStep(event?.step);
    if (event?.type === "step.end" && event.finishReason === "end_turn" && step !== undefined) {
      steps.add(step);
    }
  }
  return steps;
}

function requestParameters(raw: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== "type" && key !== "time"),
  );
}

export function buildDebugConversationRows(records: RuntimeDebugRecord[]): DebugRow[] {
  const rows: DebugRow[] = [];
  const completedSteps = finalSteps(records);
  const toolCalls = new Map<string, { name: string; step?: number | string; turnId?: string }>();
  for (const record of records) {
    const event = loopEvent(record);
    if (event?.type !== "tool.call") continue;
    const toolCallId = readString(event.toolCallId);
    const name = readString(event.name);
    if (toolCallId && name) {
      const step = readStep(event.step);
      const turnId = readString(event.turnId) ?? undefined;
      toolCalls.set(toolCallId, {
        name,
        ...(step === undefined ? {} : { step }),
        ...(turnId ? { turnId } : {}),
      });
    }
  }
  const appendedUserMessages = new Set(
    records.flatMap((record) => {
      if (record.type !== "context.append_message") return [];
      const message = isRecord(record.raw.message) ? record.raw.message : null;
      if (message?.role !== "user") return [];
      const text = textContent(message.content);
      return text ? [text] : [];
    }),
  );

  for (const record of records) {
    if (record.type === "profile.bind") {
      const systemPrompt = readString(record.raw.systemPrompt) ?? "";
      rows.push({
        ...rowBase(record, "system"),
        badge: "SYSTEM",
        title: "System prompt",
        summary: summaryOf(systemPrompt, "System prompt"),
        input: systemPrompt,
      });
      continue;
    }

    if (record.type === "turn.prompt") {
      const prompt = textContent(record.raw.input);
      if (!prompt || appendedUserMessages.has(prompt)) continue;
      rows.push({
        ...rowBase(record, "prompt"),
        badge: "USER",
        title: "User message",
        summary: summaryOf(prompt, "User message"),
        input: record.raw.input,
      });
      continue;
    }

    if (record.type === "context.append_message") {
      const message = isRecord(record.raw.message) ? record.raw.message : null;
      if (!message) continue;
      const role = readString(message.role);
      const origin = isRecord(message.origin) ? message.origin : null;
      const injected = readString(origin?.kind) === "injection";
      const content = textContent(message.content);
      const badge: DebugBadge = injected
        ? "CONTEXT"
        : role === "system"
          ? "SYSTEM"
          : role === "assistant"
            ? "ASSISTANT"
            : role === "tool"
              ? "TOOL RESULT"
              : "USER";
      const title = injected
        ? (readString(origin?.variant) ?? "Runtime context")
        : role === "system"
          ? "System message"
          : role === "assistant"
            ? "Assistant message"
            : role === "tool"
              ? (readString(message.name) ?? "Tool") + " message"
              : "User message";
      rows.push({
        ...rowBase(record, "message"),
        badge,
        title,
        summary: summaryOf(content || message.content, title),
        ...(role === "assistant" || role === "tool"
          ? { output: content || message.content }
          : { input: content || message.content }),
      });
      continue;
    }

    if (record.type === "plugin.session_start") {
      rows.push({
        ...rowBase(record, "plugin"),
        badge: "CONTEXT",
        title: "Session context",
        summary: summaryOf(record.raw.content, "Session context"),
        input: record.raw.content,
      });
      continue;
    }

    if (record.type === "llm.request") {
      const step = readStep(record.raw.turnStep);
      const model = readString(record.raw.model) ?? readString(record.raw.modelAlias) ?? "model";
      const messageCount = readNumber(record.raw.messageCount);
      rows.push({
        ...rowBase(record, "llm"),
        badge: "LLM",
        title: "LLM request" + (step === undefined ? "" : " · Step " + step),
        summary: model + (messageCount === undefined ? "" : " · " + messageCount + " messages"),
        input: requestParameters(record.raw),
        ...(step === undefined ? {} : { step }),
      });
      continue;
    }

    if (record.type === "llm.tools_snapshot") {
      const tools = Array.isArray(record.raw.tools) ? record.raw.tools : [];
      rows.push({
        ...rowBase(record, "llm-tools"),
        badge: "LLM",
        title: "Tool definitions",
        summary: tools.length + (tools.length === 1 ? " tool" : " tools"),
        input: requestParameters(record.raw),
      });
      continue;
    }

    if (record.type === "wire.parse_error") {
      rows.push({
        ...rowBase(record, "parse-error"),
        badge: "ERROR",
        title: "Wire parse error",
        summary: summaryOf(record.raw.value, "Malformed wire record"),
        output: record.raw.value,
      });
      continue;
    }

    if (record.type !== "context.append_loop_event") continue;
    const event = loopEvent(record);
    if (!event) continue;
    const eventType = readString(event.type) ?? "loop.event";
    const step = readStep(event.step);
    const turnId = readString(event.turnId) ?? undefined;
    const metadata = {
      ...(step === undefined ? {} : { step }),
      ...(turnId ? { turnId } : {}),
    };

    if (eventType === "step.begin") {
      rows.push({
        ...rowBase(record, "step-begin"),
        ...metadata,
        badge: "STEP",
        title: "Step " + (step ?? "?") + " started",
        summary: turnId ? "Turn " + turnId : "Agent loop step",
        input: event,
      });
      continue;
    }

    if (eventType === "content.part") {
      const part = isRecord(event.part) ? event.part : null;
      const partType = readString(part?.type);
      if (partType === "think") {
        const thought = readString(part?.think) ?? "";
        rows.push({
          ...rowBase(record, "thought"),
          ...metadata,
          badge: "THOUGHT",
          title: "Thinking" + (step === undefined ? "" : " · Step " + step),
          summary: summaryOf(thought, "Thinking"),
          output: thought,
        });
      } else {
        const text = readString(part?.text) ?? textContent(part);
        const final = step !== undefined && completedSteps.has(step);
        rows.push({
          ...rowBase(record, "assistant"),
          ...metadata,
          badge: "ASSISTANT",
          title: final ? "Final response" : "Assistant message",
          summary: summaryOf(text, "Assistant message"),
          output: text,
          final,
        });
      }
      continue;
    }

    if (eventType === "tool.call") {
      const name = readString(event.name) ?? "Tool";
      rows.push({
        ...rowBase(record, "tool-call"),
        ...metadata,
        badge: "TOOL CALL",
        title: name,
        summary: summaryOf(event.args, name),
        input: event.args,
      });
      continue;
    }

    if (eventType === "tool.result") {
      const result = event.result;
      const failed = isRecord(result) && result.isError === true;
      const toolCallId = readString(event.toolCallId);
      const call = toolCallId ? toolCalls.get(toolCallId) : undefined;
      const name = call?.name ?? "Tool";
      const resultMetadata = {
        ...(step === undefined && call?.step !== undefined ? { step: call.step } : {}),
        ...(!turnId && call?.turnId ? { turnId: call.turnId } : {}),
      };
      rows.push({
        ...rowBase(record, "tool-result"),
        ...metadata,
        ...resultMetadata,
        badge: failed ? "ERROR" : "TOOL RESULT",
        title: failed ? name + " failed" : name + " result",
        summary: summaryOf(result, "Tool result"),
        output: result,
      });
      continue;
    }

    if (eventType === "step.end") {
      const finishReason = readString(event.finishReason) ?? "unknown";
      rows.push({
        ...rowBase(record, "step-end"),
        ...metadata,
        badge: "STEP",
        title: "Step " + (step ?? "?") + " finished",
        summary: "Finish reason: " + finishReason,
        output: event,
      });
    }
  }

  return rows;
}

function persistedMessageText(message: Message): string {
  if (message.type === "changed_files") return message.content ?? "";
  if (message.content) return message.content;
  return (message.parts ?? [])
    .flatMap((part) => (part.type === "text" ? [part.content] : []))
    .join("");
}

function persistedMessageTime(message: Message): number | undefined {
  if (message.role === "assistant" && typeof message.runFinishedAt === "number") {
    return message.runFinishedAt;
  }
  if (typeof message.createdAt === "number") return message.createdAt;
  if (typeof message.createdAt !== "string") return undefined;
  const parsed = Date.parse(message.createdAt);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function rowMessageText(row: DebugRow): string {
  const value = row.badge === "ASSISTANT" ? row.output : row.input;
  return collapse(typeof value === "string" ? value : textContent(value));
}

function alreadyRepresented(rows: DebugRow[], badge: "USER" | "ASSISTANT", content: string) {
  const normalized = collapse(content);
  if (!normalized) return true;
  return rows.some((row) => {
    if (row.badge !== badge) return false;
    const existing = rowMessageText(row);
    return existing === normalized || existing.startsWith(normalized + " ");
  });
}

export function addPersistedConversationRows(
  rows: DebugRow[],
  messages: Message[],
  sequenceBase = 0,
): DebugRow[] {
  const result = [...rows];
  let sequence = rows.reduce((maximum, row) => Math.max(maximum, row.sequence), sequenceBase);
  const finalAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && persistedMessageText(message))?.id;

  for (const message of messages) {
    if (message.type === "changed_files") continue;
    const content = persistedMessageText(message);
    const badge = message.role === "assistant" ? "ASSISTANT" : "USER";
    if (!content || alreadyRepresented(result, badge, content)) continue;
    const final = message.role === "assistant" && message.id === finalAssistantId;
    const time = persistedMessageTime(message);
    sequence += 1;
    result.push({
      id: "message:" + message.id,
      sequence,
      badge,
      title: final
        ? "Final response"
        : message.role === "assistant"
          ? "Assistant message"
          : "User message",
      summary: summaryOf(content, badge === "ASSISTANT" ? "Assistant message" : "User message"),
      raw: { source: "carrent-message", message },
      ...(badge === "ASSISTANT" ? { output: content } : { input: content }),
      ...(time === undefined ? {} : { time }),
      ...(final ? { final: true } : {}),
    });
  }

  return result;
}

function rawEventTitle(record: RuntimeDebugRecord) {
  const event = loopEvent(record);
  return event && typeof event.type === "string" ? record.type + " · " + event.type : record.type;
}

export function buildDebugRawRows(records: RuntimeDebugRecord[]): DebugRow[] {
  return records.map((record) => ({
    ...rowBase(record, "raw"),
    badge: record.type === "wire.parse_error" ? "ERROR" : "EVENT",
    title: record.type,
    summary: summaryOf(record.raw, rawEventTitle(record)),
  }));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTime(value: number | undefined) {
  if (value === undefined) return "";
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function matchesQuery(row: DebugRow, query: string) {
  if (!query) return true;
  return (row.badge + "\n" + row.title + "\n" + row.summary + "\n" + stringify(row.raw))
    .toLowerCase()
    .includes(query);
}

function DebugSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 px-4 py-3" aria-label="Loading Debug trace">
      {[72, 48, 84, 64, 92, 58].map((width, index) => (
        <div key={index} className="flex h-8 animate-pulse items-center gap-3">
          <div className="h-5 w-24 rounded bg-surface-hover" />
          <div className="h-3 rounded bg-surface-hover" style={{ width: width + "%" }} />
        </div>
      ))}
    </div>
  );
}

export function DebugTimeline({ threadId, messages }: { threadId: string; messages: Message[] }) {
  const [trace, setTrace] = useState<RuntimeDebugTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DebugView>("conversation");
  const [query, setQuery] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("raw");
  const [detailSourceTab, setDetailSourceTab] = useState<DetailSourceTab>("raw");
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);
  const activeThreadId = useRef(threadId);
  activeThreadId.current = threadId;

  const loadTrace = useCallback(
    async (initial = false) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (initial) setLoading(true);
      else setRefreshing(true);
      try {
        const next = await window.carrent.chat.getDebugTrace({
          runtimeId: "kimi",
          threadId,
        });
        if (activeThreadId.current === threadId) {
          setTrace((current) => {
            if (
              current?.sessionId === next?.sessionId &&
              current?.fileSize === next?.fileSize &&
              current?.modifiedAt === next?.modifiedAt &&
              current?.truncated === next?.truncated &&
              current?.parseErrorCount === next?.parseErrorCount
            ) {
              return current;
            }
            return next;
          });
          setError(null);
        }
      } catch (caught) {
        if (activeThreadId.current === threadId) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        inFlight.current = false;
        if (activeThreadId.current === threadId) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [threadId],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setTrace(null);
    setSelectedRowId(null);
    setError(null);

    const refresh = async (initial = false): Promise<void> => {
      await loadTrace(initial);
      if (!cancelled) {
        timer = window.setTimeout(() => void refresh(), 1_500);
      }
    };
    void refresh(true);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadTrace]);

  const wireConversationRows = useMemo(
    () => buildDebugConversationRows(trace?.records ?? []),
    [trace],
  );
  const conversationRows = useMemo(
    () =>
      addPersistedConversationRows(wireConversationRows, messages, trace?.records.at(-1)?.sequence),
    [messages, trace, wireConversationRows],
  );
  const persistedRowCount = conversationRows.length - wireConversationRows.length;
  const rawRows = useMemo(() => buildDebugRawRows(trace?.records ?? []), [trace]);
  const rows = view === "conversation" ? conversationRows : rawRows;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = rows.filter((row) => matchesQuery(row, normalizedQuery));
  const selected = rows.find((row) => row.id === selectedRowId) ?? null;
  const toolCallCount = conversationRows.filter((row) => row.badge === "TOOL CALL").length;
  const llmCallCount = conversationRows.filter((row) => row.badge === "LLM").length;
  const messageCount = conversationRows.filter((row) =>
    ["SYSTEM", "USER", "CONTEXT", "ASSISTANT", "THOUGHT"].includes(row.badge),
  ).length;

  const selectRow = (row: DebugRow) => {
    setSelectedRowId(row.id);
    setDetailTab("raw");
    setDetailSourceTab("raw");
  };

  const detailValue =
    detailSourceTab === "input"
      ? selected?.input
      : detailSourceTab === "output"
        ? selected?.output
        : selected?.raw;
  const structuredJson = useMemo(() => toStructuredJson(detailValue), [detailValue]);

  const copyDetail = async () => {
    await navigator.clipboard.writeText(stringify(detailValue));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-debug-timeline>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
          {(
            [
              { key: "conversation", label: "Conversation" },
              { key: "raw", label: "Raw Events" },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={view === item.key}
              onClick={() => {
                setView(item.key);
                setSelectedRowId(null);
              }}
              className={
                "rounded px-2 py-0.5 text-app-12 transition " +
                (view === item.key ? "bg-surface-hover text-fg" : "text-muted hover:text-fg")
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        {trace ? (
          <>
            <span className="text-app-11 tabular-nums text-subtle">{messageCount} messages</span>
            <span className="text-app-11 tabular-nums text-subtle">{toolCallCount} tools</span>
            <span className="text-app-11 tabular-nums text-subtle">{llmCallCount} LLM calls</span>
            <span className="text-app-11 tabular-nums text-subtle">
              {trace.records.length} records
            </span>
          </>
        ) : null}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search Runtime Debug trace"
            className="h-7 w-48 rounded-md border border-border bg-surface pl-7 pr-2 text-app-12 text-fg outline-none placeholder:text-subtle focus:border-border-strong"
          />
        </div>
        <button
          type="button"
          title="Refresh trace"
          aria-label="Refresh trace"
          onClick={() => void loadTrace()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <RefreshCw className={"h-3.5 w-3.5 " + (refreshing ? "animate-spin" : "")} />
        </button>
      </div>

      {trace ? (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 font-mono text-app-10 text-subtle">
          <Database className="h-3 w-3 shrink-0" />
          <span className="min-w-0 truncate" title={trace.sourcePath}>
            {trace.sourcePath}
          </span>
          {persistedRowCount > 0 ? (
            <span className="shrink-0 text-muted">+ {persistedRowCount} persisted</span>
          ) : null}
          <span className="ml-auto shrink-0 tabular-nums">{formatFileSize(trace.fileSize)}</span>
          {trace.truncated ? (
            <span className="flex shrink-0 items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" />
              Partial
            </span>
          ) : null}
          {trace.parseErrorCount > 0 ? (
            <span className="shrink-0 text-danger">{trace.parseErrorCount} parse errors</span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <DebugSkeleton />
      ) : error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="max-w-xl text-center">
            <AlertTriangle className="mx-auto h-5 w-5 text-danger" />
            <p className="mt-2 text-app-13 text-fg">Runtime Debug trace unavailable</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-app-11 text-danger">
              {error}
            </pre>
          </div>
        </div>
      ) : !trace ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="text-center">
            <Database className="mx-auto h-5 w-5 text-subtle" />
            <p className="mt-2 text-app-13 text-fg">No Runtime Session trace</p>
            <p className="mt-1 text-app-11 text-subtle">Start a Kimi run in this Thread.</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 py-2 font-mono text-app-12">
            {visibleRows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => selectRow(row)}
                className={
                  "grid min-h-9 w-full grid-cols-[3.25rem_6.5rem_minmax(0,1fr)] items-start gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30 " +
                  (row.id === selectedRowId ? "bg-surface-hover" : "")
                }
              >
                <span className="pt-0.5 text-app-10 tabular-nums text-subtle">#{row.sequence}</span>
                <span
                  className={
                    "truncate rounded border px-1 py-px text-center text-app-9 font-semibold " +
                    BADGE_STYLES[row.badge]
                  }
                  title={row.badge}
                >
                  {row.badge}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span
                      className={
                        "truncate text-app-11 font-medium " +
                        (row.badge === "ERROR" ? "text-danger" : "text-fg")
                      }
                    >
                      {row.title}
                    </span>
                    {row.final ? (
                      <span className="shrink-0 rounded border border-success/30 bg-success/10 px-1 text-app-9 text-success">
                        FINAL
                      </span>
                    ) : null}
                    {row.time !== undefined ? (
                      <span className="ml-auto shrink-0 text-app-10 text-subtle">
                        {formatTime(row.time)}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-app-11 text-muted">
                    {row.summary}
                  </span>
                </span>
              </button>
            ))}
            {visibleRows.length === 0 ? (
              <div className="py-12 text-center text-app-12 text-subtle">No matching records</div>
            ) : null}
          </div>

          {selected ? (
            <aside className="flex w-[min(40%,32rem)] min-w-[22rem] shrink-0 flex-col border-l border-border bg-bg">
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
                <span
                  className={
                    "rounded border px-1.5 py-px text-app-9 font-semibold " +
                    BADGE_STYLES[selected.badge]
                  }
                >
                  {selected.badge}
                </span>
                <span className="min-w-0 truncate text-app-11 text-fg">{selected.title}</span>
                <span className="ml-auto shrink-0 font-mono text-app-10 text-subtle">
                  #{selected.sequence}
                </span>
                <button
                  type="button"
                  title="Close details"
                  aria-label="Close details"
                  onClick={() => setSelectedRowId(null)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex h-8 shrink-0 items-end gap-4 border-b border-border px-3 text-app-11">
                {(
                  [
                    { key: "raw", label: "Raw", visible: true },
                    { key: "input", label: "Input", visible: selected.input !== undefined },
                    { key: "output", label: "Output", visible: selected.output !== undefined },
                  ] as const
                )
                  .filter((tab) => tab.visible)
                  .map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => {
                        setDetailTab(tab.key);
                        setDetailSourceTab(tab.key);
                      }}
                      className={
                        "h-8 border-b-2 px-0.5 transition " +
                        (detailTab === tab.key
                          ? "border-brand text-fg"
                          : "border-transparent text-muted hover:text-fg")
                      }
                    >
                      {tab.label}
                    </button>
                  ))}
                {structuredJson.ok ? (
                  <button
                    type="button"
                    onClick={() => setDetailTab("json")}
                    className={
                      "h-8 border-b-2 px-0.5 transition " +
                      (detailTab === "json"
                        ? "border-brand text-fg"
                        : "border-transparent text-muted hover:text-fg")
                    }
                  >
                    JSON
                  </button>
                ) : null}
                <button
                  type="button"
                  title="Copy selected data"
                  aria-label="Copy selected data"
                  onClick={() => void copyDetail()}
                  className="ml-auto mb-1 flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-code-bg p-3">
                {detailTab === "json" && structuredJson.ok ? (
                  <JsonTree
                    key={selected.id + ":" + detailSourceTab}
                    value={structuredJson.value}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-mono text-app-11 leading-relaxed text-muted">
                    {stringify(detailValue)}
                  </pre>
                )}
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}
