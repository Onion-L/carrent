import { useCallback, useEffect, useMemo, useState } from "react";
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

import type { AgentDebugRecord, AgentDebugTrace } from "../../../shared/agentDebug";

export type DebugBadge =
  | "SYSTEM"
  | "USER"
  | "CONTEXT"
  | "ASSISTANT"
  | "THOUGHT"
  | "TOOL CALL"
  | "TOOL RESULT"
  | "APPROVAL"
  | "LLM"
  | "STEP"
  | "EVENT"
  | "ERROR";

export type DebugRow = {
  id: string;
  sequence: number;
  runId: string;
  badge: DebugBadge;
  title: string;
  summary: string;
  raw: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  time: number;
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
  APPROVAL: "border-warning/40 bg-warning/10 text-warning",
  LLM: "border-debug-llm/40 bg-debug-llm/10 text-debug-llm",
  STEP: "border-debug-step/40 bg-debug-step/10 text-debug-step",
  EVENT: "border-debug-event/40 bg-debug-event/10 text-debug-event",
  ERROR: "border-debug-error/40 bg-debug-error/10 text-debug-error",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function collapse(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function summaryOf(value: unknown, fallback: string, limit = 220): string {
  const text = collapse(stringify(value)) || fallback;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(messageText).filter(Boolean).join("");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  return messageText(value.content);
}

function messageRole(value: unknown): string {
  return isRecord(value) && typeof value.role === "string" ? value.role : "message";
}

function baseRow(record: AgentDebugRecord, suffix: string) {
  return {
    id: `${record.runId}:${record.sequence}:${suffix}`,
    sequence: record.sequence,
    runId: record.runId,
    raw: record.raw,
    time: record.time,
  };
}

export function buildAgentDebugConversationRows(records: AgentDebugRecord[]): DebugRow[] {
  const rows: DebugRow[] = [];
  // The system prompt precedes the user prompt in the actual model call, so the
  // request row is held back until the context rows have been rendered.
  let pendingRequestRow: DebugRow | null = null;
  const flushPendingRequest = () => {
    if (pendingRequestRow) {
      rows.push(pendingRequestRow);
      pendingRequestRow = null;
    }
  };

  for (const record of records) {
    const raw = record.raw;
    if (record.type === "run.requested") {
      pendingRequestRow = {
        ...baseRow(record, "request"),
        badge: "USER",
        title: "Run request",
        summary: summaryOf(raw.prompt, "Run request"),
        input: raw,
      };
      continue;
    }

    if (record.type === "core.context") {
      const model = isRecord(raw.model) ? raw.model : {};
      rows.push({
        ...baseRow(record, "system"),
        badge: "SYSTEM",
        title: "System prompt",
        summary: summaryOf(raw.systemPrompt, "System prompt"),
        input: raw.systemPrompt,
      });
      rows.push({
        ...baseRow(record, "context"),
        badge: "LLM",
        title: "Provider context",
        summary: [model.providerType, model.modelId].filter(Boolean).join(" · ") || "Model context",
        input: { model: raw.model, messages: raw.messages, tools: raw.tools },
      });
      flushPendingRequest();
      continue;
    }

    flushPendingRequest();

    if (record.type === "message_end") {
      const message = raw.message;
      const role = messageRole(message);
      const content = isRecord(message) ? message.content : undefined;
      const text = messageText(content);
      const badge: DebugBadge =
        role === "assistant" ? "ASSISTANT" : role === "toolResult" ? "TOOL RESULT" : "USER";
      rows.push({
        ...baseRow(record, "message"),
        badge,
        title:
          role === "assistant"
            ? "Assistant message"
            : role === "toolResult"
              ? "Tool result message"
              : "User message",
        summary: summaryOf(text || content, `${role} message`),
        ...(badge === "TOOL RESULT" ? { output: message } : { input: message }),
      });
      continue;
    }

    if (record.type === "tool_execution_start") {
      const name = typeof raw.toolName === "string" ? raw.toolName : "Tool";
      rows.push({
        ...baseRow(record, "tool-start"),
        badge: "TOOL CALL",
        title: name,
        summary: summaryOf(raw.args, `${name} call`),
        input: raw.args,
      });
      continue;
    }

    if (record.type === "tool_execution_end") {
      const name = typeof raw.toolName === "string" ? raw.toolName : "Tool";
      const failed = raw.isError === true;
      rows.push({
        ...baseRow(record, "tool-end"),
        badge: failed ? "ERROR" : "TOOL RESULT",
        title: failed ? `${name} failed` : `${name} result`,
        summary: summaryOf(raw.result, `${name} result`),
        output: raw.result,
      });
      continue;
    }

    if (record.type === "approval.requested" || record.type === "approval.resolved") {
      const request = isRecord(raw.request) ? raw.request : {};
      const toolName = typeof request.toolName === "string" ? request.toolName : "Tool";
      const decision = typeof raw.decision === "string" ? raw.decision : "waiting";
      rows.push({
        ...baseRow(record, "approval"),
        badge: "APPROVAL",
        title:
          record.type === "approval.requested" ? `${toolName} approval` : `Approval ${decision}`,
        summary: summaryOf(request.description ?? request.command ?? request.path, decision),
        input: raw,
      });
      continue;
    }

    if (record.type === "turn_start" || record.type === "turn_end") {
      rows.push({
        ...baseRow(record, "turn"),
        badge: "STEP",
        title: record.type === "turn_start" ? "Turn started" : "Turn completed",
        summary: record.type,
        output: record.type === "turn_end" ? raw : undefined,
      });
      continue;
    }

    if (record.type === "run.completed") {
      rows.push({
        ...baseRow(record, "completed"),
        badge: "ASSISTANT",
        title: "Final response",
        summary: summaryOf(raw.text, "Run completed"),
        output: raw.text,
        final: true,
      });
      continue;
    }

    if (record.type === "run.failed" || record.type === "run.stopped") {
      rows.push({
        ...baseRow(record, "terminal"),
        badge: record.type === "run.failed" ? "ERROR" : "EVENT",
        title: record.type === "run.failed" ? "Run failed" : "Run stopped",
        summary: summaryOf(raw.error, record.type),
        output: raw,
        final: true,
      });
      continue;
    }

    if (record.type === "agent_start" || record.type === "agent_end") {
      rows.push({
        ...baseRow(record, "agent"),
        badge: "EVENT",
        title: record.type === "agent_start" ? "Agent started" : "Agent finished",
        summary: record.type,
        output: record.type === "agent_end" ? raw.messages : undefined,
      });
    }
  }

  flushPendingRequest();
  return rows;
}

export function buildAgentDebugRawRows(records: AgentDebugRecord[]): DebugRow[] {
  return records.map((record) => ({
    ...baseRow(record, "raw"),
    badge:
      record.type === "run.failed" ||
      (record.type === "tool_execution_end" && record.raw.isError === true)
        ? "ERROR"
        : "EVENT",
    title: record.type,
    summary: summaryOf(record.raw, record.type),
    input: record.raw,
  }));
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

function JsonKey({ name, arrayItem }: { name: string; arrayItem: boolean }) {
  return (
    <span className="shrink-0 text-fg">{arrayItem ? `[${name}]` : `${JSON.stringify(name)}:`}</span>
  );
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
        <span className="min-w-0 whitespace-pre-wrap break-words text-debug-tool-result">
          {value === null ? "null" : JSON.stringify(value)}
        </span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  const opening = Array.isArray(value) ? "[" : "{";
  const closing = Array.isArray(value) ? "]" : "}";
  const empty = entries.length === 0;
  return (
    <div>
      <button
        type="button"
        aria-expanded={empty ? undefined : expanded}
        aria-label={empty ? undefined : `${expanded ? "Collapse" : "Expand"} JSON ${path}`}
        disabled={empty}
        onClick={() => setExpanded((current) => !current)}
        className="flex max-w-full items-center gap-1 rounded text-left text-muted hover:text-fg disabled:cursor-default"
        style={{ paddingLeft }}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {empty ? null : <ChevronRight className={`h-3 w-3 ${expanded ? "rotate-90" : ""}`} />}
        </span>
        {name === undefined ? null : <JsonKey name={name} arrayItem={arrayItem} />}
        <span>{opening}</span>
        {!empty && !expanded ? (
          <span className="text-subtle">
            {entries.length} items {closing}
          </span>
        ) : null}
      </button>
      {!empty && expanded ? (
        <>
          {entries.map(([key, child]) => (
            <JsonTreeNode
              key={key}
              value={child}
              name={key}
              path={`${path}${Array.isArray(value) ? `[${key}]` : `.${key}`}`}
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

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function matchesQuery(row: DebugRow, query: string) {
  if (!query) return true;
  return `${row.badge}\n${row.title}\n${row.summary}\n${stringify(row.raw)}`
    .toLowerCase()
    .includes(query);
}

function DebugSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 px-4 py-3" aria-label="Loading Debug trace">
      {[72, 48, 84, 64, 92, 58].map((width) => (
        <div key={width} className="flex h-8 animate-pulse items-center gap-3">
          <div className="h-5 w-24 rounded bg-surface-hover" />
          <div className="h-3 rounded bg-surface-hover" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}

export function AgentDebugTimeline({ threadId }: { threadId: string }) {
  const [trace, setTrace] = useState<AgentDebugTrace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DebugView>("conversation");
  const [query, setQuery] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("raw");
  const [detailSourceTab, setDetailSourceTab] = useState<DetailSourceTab>("raw");
  const [copied, setCopied] = useState(false);

  const loadTrace = useCallback(
    async (initial = false) => {
      if (!threadId) return;
      if (initial) setLoading(true);
      else setRefreshing(true);
      try {
        setTrace(await window.carrent.chat.getDebugTrace({ threadId }));
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [threadId],
  );

  useEffect(() => {
    setTrace(null);
    setSelectedRowId(null);
    void loadTrace(true);
    let timer: number | undefined;
    const unsubscribe = window.carrent.chat.onDebugChanged((change) => {
      if (change.threadId !== threadId || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void loadTrace();
      }, 120);
    });
    return () => {
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [loadTrace, threadId]);

  const rows = useMemo(
    () =>
      trace
        ? view === "conversation"
          ? buildAgentDebugConversationRows(trace.records)
          : buildAgentDebugRawRows(trace.records)
        : [],
    [trace, view],
  );
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return rows.filter((row) => matchesQuery(row, normalized));
  }, [query, rows]);
  const selected = rows.find((row) => row.id === selectedRowId) ?? null;
  const detailValue = selected?.[detailSourceTab];
  const structured = toStructuredJson(detailValue);

  useEffect(() => {
    if (selectedRowId && !rows.some((row) => row.id === selectedRowId)) setSelectedRowId(null);
  }, [rows, selectedRowId]);

  const selectRow = (row: DebugRow) => {
    setSelectedRowId(row.id);
    setDetailTab("raw");
    setDetailSourceTab("raw");
  };

  const copyDetail = async () => {
    if (detailValue === undefined) return;
    await window.carrent.clipboard.writeText(stringify(detailValue));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_200);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-debug-timeline>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
          {(["conversation", "raw"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={view === item}
              onClick={() => {
                setView(item);
                setSelectedRowId(null);
              }}
              className={`rounded px-2 py-0.5 text-app-11 transition ${view === item ? "bg-surface-hover text-fg" : "text-muted hover:text-fg"}`}
            >
              {item === "conversation" ? "Conversation" : "Raw"}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-64 max-w-[40%]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search events"
            aria-label="Search Debug events"
            className="h-7 w-full rounded-md border border-border bg-surface pl-7 pr-2 text-app-12 text-fg outline-none placeholder:text-subtle focus:border-border-strong"
          />
        </div>
        <button
          type="button"
          title="Refresh trace"
          aria-label="Refresh trace"
          onClick={() => void loadTrace()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {trace ? (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 font-mono text-app-10 text-subtle">
          <Database className="h-3 w-3" />
          <span>Agent Core · in-memory</span>
          <span className="ml-auto tabular-nums">{trace.records.length} events</span>
          {trace.truncated ? (
            <span className="flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" />
              Partial
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <DebugSkeleton />
      ) : error ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <div>
            <AlertTriangle className="mx-auto h-5 w-5 text-danger" />
            <p className="mt-2 text-app-13 text-fg">Agent Debug unavailable</p>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-app-11 text-danger">
              {error}
            </pre>
          </div>
        </div>
      ) : !trace ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
          <div>
            <Database className="mx-auto h-5 w-5 text-subtle" />
            <p className="mt-2 text-app-13 text-fg">No Agent Core events</p>
            <p className="mt-1 text-app-11 text-subtle">Start a Run in this Thread.</p>
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
                className={`grid min-h-9 w-full grid-cols-[3.25rem_6.5rem_minmax(0,1fr)] items-start gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-hover ${row.id === selectedRowId ? "bg-surface-hover" : ""}`}
              >
                <span className="pt-0.5 text-app-10 tabular-nums text-subtle">#{row.sequence}</span>
                <span
                  className={`truncate rounded border px-1 py-px text-center text-app-9 font-semibold ${BADGE_STYLES[row.badge]}`}
                >
                  {row.badge}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span
                      className={`truncate text-app-11 font-medium ${row.badge === "ERROR" ? "text-danger" : "text-fg"}`}
                    >
                      {row.title}
                    </span>
                    {row.final ? (
                      <span className="shrink-0 rounded border border-success/30 bg-success/10 px-1 text-app-9 text-success">
                        FINAL
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-app-10 text-subtle">
                      {formatTime(row.time)}
                    </span>
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
                  className={`rounded border px-1.5 py-px text-app-9 font-semibold ${BADGE_STYLES[selected.badge]}`}
                >
                  {selected.badge}
                </span>
                <span className="min-w-0 truncate text-app-11 text-fg">{selected.title}</span>
                <span className="ml-auto font-mono text-app-10 text-subtle">
                  #{selected.sequence}
                </span>
                <button
                  type="button"
                  title="Close details"
                  aria-label="Close details"
                  onClick={() => setSelectedRowId(null)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex h-8 shrink-0 items-end gap-4 border-b border-border px-3 text-app-11">
                {(["raw", "input", "output"] as const)
                  .filter((tab) => selected[tab] !== undefined)
                  .map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setDetailTab(tab);
                        setDetailSourceTab(tab);
                      }}
                      className={`h-8 border-b-2 px-0.5 capitalize transition ${detailTab === tab ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}
                    >
                      {tab}
                    </button>
                  ))}
                {structured.ok ? (
                  <button
                    type="button"
                    onClick={() => setDetailTab("json")}
                    className={`h-8 border-b-2 px-0.5 transition ${detailTab === "json" ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg"}`}
                  >
                    JSON
                  </button>
                ) : null}
                <button
                  type="button"
                  title="Copy details"
                  aria-label="Copy details"
                  onClick={() => void copyDetail()}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-code-bg p-3">
                {detailTab === "json" && structured.ok ? (
                  <JsonTree key={`${selected.id}:${detailSourceTab}`} value={structured.value} />
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-mono text-app-11 leading-5 text-fg">
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
