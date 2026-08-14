import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import type { Message, MessagePart } from "../../../shared/threadContent";

// Dev-only raw conversation view: flattens every message part into
// badge-prefixed rows grouped by turn, for local debugging. Selecting a row
// opens a side panel with the untruncated raw payload/result.

type DebugBadge = "USER" | "ASSISTANT" | "TOOL" | "CONTEXT" | "ERROR";

type DebugRow = {
  id: string;
  badge: DebugBadge;
  summary: string;
  // The source object (message / part / timeline item) this row was derived
  // from; the detail panel renders it as untruncated JSON.
  raw: unknown;
  // Raw, never truncated: full text content or the tool's raw input JSON.
  payload?: string;
  // Raw, never truncated: the tool's raw output / error.
  result?: string;
};

type DebugTurn = {
  id: string;
  index: number;
  rows: DebugRow[];
  durationMs: number;
};

const BADGE_STYLES: Record<DebugBadge, string> = {
  USER: "bg-blue-500/15 text-blue-400",
  ASSISTANT: "bg-purple-500/15 text-purple-400",
  TOOL: "bg-amber-500/15 text-amber-400",
  CONTEXT: "bg-emerald-500/15 text-emerald-400",
  ERROR: "bg-red-500/15 text-red-400",
};

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, limit = 160): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function messageStartMs(message: Message): number | null {
  const { createdAt } = message;
  if (typeof createdAt === "number") return createdAt;
  if (typeof createdAt === "string") {
    const parsed = Date.parse(createdAt);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function partRows(messageId: string, part: MessagePart, index: number): DebugRow[] {
  const id = `${messageId}:part:${index}`;
  switch (part.type) {
    case "text":
    case "reasoning":
      return [
        {
          id,
          badge: "ASSISTANT",
          summary: truncate(collapse(part.content)),
          raw: part,
          payload: part.content,
        },
      ];
    case "kimi_timeline": {
      const item = part.item;
      if (item.type === "tool") {
        const label = item.title || item.kind || "tool";
        const resultText = item.error || item.output;
        return [
          {
            id,
            badge: item.status === "failed" ? "ERROR" : "TOOL",
            summary: truncate(
              collapse(`${label} ${item.input}${resultText ? ` → ${resultText}` : ""}`),
            ),
            raw: item,
            payload: item.input,
            result: [item.error, item.output].filter(Boolean).join("\n\n") || undefined,
          },
        ];
      }
      return [
        {
          id,
          badge: "ASSISTANT",
          summary: truncate(collapse(item.content)),
          raw: item,
          payload: item.content,
        },
      ];
    }
    case "shell":
      return [
        {
          id,
          badge: part.status === "failed" ? "ERROR" : "TOOL",
          summary: truncate(collapse(`$ ${part.command}${part.output ? ` → ${part.output}` : ""}`)),
          raw: part,
          payload: part.command,
          result: part.output || undefined,
        },
      ];
    case "plan_review":
      return [
        {
          id,
          badge: "TOOL",
          summary: `plan_review (${part.status})`,
          raw: part,
          payload: part.content,
        },
      ];
    case "question":
      return [
        {
          id,
          badge: "TOOL",
          summary: truncate(
            collapse(
              `question (${part.status}): ${part.questions.map((q) => q.question).join(" | ")}`,
            ),
          ),
          raw: part,
          payload: part.questions.map((q) => `[${q.header}] ${q.question}`).join("\n"),
        },
      ];
    case "subagent_task":
      return [
        {
          id,
          badge: "TOOL",
          summary: truncate(collapse(`subagent (${part.status}): ${part.description}`)),
          raw: part,
          payload: part.prompt ?? part.description,
        },
      ];
    case "error":
      return [
        {
          id,
          badge: "ERROR",
          summary: truncate(collapse(part.message)),
          raw: part,
          payload: part.message,
        },
      ];
  }
}

export function buildDebugTurns(messages: Message[]): DebugTurn[] {
  const turns: DebugTurn[] = [];
  let current: DebugTurn | null = null;

  for (const message of messages) {
    if (message.role === "user" || !current) {
      current = { id: message.id, index: turns.length + 1, rows: [], durationMs: 0 };
      turns.push(current);
    }
    const turn = current;

    const startMs = messageStartMs(message);
    if (
      message.role === "assistant" &&
      startMs !== null &&
      typeof message.runFinishedAt === "number"
    ) {
      turn.durationMs += Math.max(0, message.runFinishedAt - startMs);
    }

    if (message.type === "changed_files") {
      const files = message.changedFiles
        .map((file) => `${file.path} (+${file.additions} -${file.deletions})`)
        .join("\n");
      turn.rows.push({
        id: message.id,
        badge: "CONTEXT",
        summary: truncate(collapse(`changed files: ${files}`)),
        raw: message,
        payload: files,
      });
      continue;
    }

    if (message.role === "user") {
      turn.rows.push({
        id: `${message.id}:user`,
        badge: "USER",
        summary: truncate(collapse(message.content)),
        raw: message,
        payload: message.content,
      });
      for (const context of message.localPathContexts ?? []) {
        turn.rows.push({
          id: `${message.id}:ctx:${context.path}`,
          badge: "CONTEXT",
          summary: `${context.kind}: ${context.path}`,
          raw: context,
          payload: context.path,
        });
      }
      continue;
    }

    if (message.parts && message.parts.length > 0) {
      message.parts.forEach((part, index) => {
        turn.rows.push(...partRows(message.id, part, index));
      });
    } else if (message.content) {
      turn.rows.push({
        id: `${message.id}:text`,
        badge: "ASSISTANT",
        summary: truncate(collapse(message.content)),
        raw: message,
        payload: message.content,
      });
    }
  }

  return turns;
}

type SelectedRow = { turn: DebugTurn; row: DebugRow; step: number };

export function DebugTimeline({ messages }: { messages: Message[] }) {
  const [query, setQuery] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"raw" | "payload" | "result">("raw");
  const turns = useMemo(() => buildDebugTurns(messages), [messages]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleTurns = normalizedQuery
    ? turns
        .map((turn) => ({
          ...turn,
          rows: turn.rows.filter((row) =>
            `${row.summary}\n${row.payload ?? ""}\n${row.result ?? ""}`
              .toLowerCase()
              .includes(normalizedQuery),
          ),
        }))
        .filter((turn) => turn.rows.length > 0)
    : turns;

  const toolCallCount = turns.reduce(
    (count, turn) => count + turn.rows.filter((row) => row.badge === "TOOL").length,
    0,
  );
  const totalDurationMs = turns.reduce((total, turn) => total + turn.durationMs, 0);

  let selected: SelectedRow | null = null;
  for (const turn of turns) {
    const step = turn.rows.findIndex((row) => row.id === selectedRowId);
    const row = step >= 0 ? turn.rows[step] : undefined;
    if (row) {
      selected = { turn, row, step: step + 1 };
      break;
    }
  }

  const selectRow = (row: DebugRow) => {
    setSelectedRowId(row.id);
    setDetailTab("raw");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-debug-timeline>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <span className="rounded border border-border bg-surface px-2 py-0.5 text-app-11 text-muted">
          Turns {turns.length}
        </span>
        <span className="rounded border border-border bg-surface px-2 py-0.5 text-app-11 text-muted">
          Calls {toolCallCount}
        </span>
        {totalDurationMs > 0 ? (
          <span className="rounded border border-border bg-surface px-2 py-0.5 text-app-11 text-muted">
            Duration {formatDuration(totalDurationMs)}
          </span>
        ) : null}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索"
            aria-label="搜索调试记录"
            className="h-7 w-44 rounded-md border border-border bg-surface pl-7 pr-2 text-app-12 text-fg outline-none placeholder:text-subtle focus:border-border-strong"
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-app-12">
          {visibleTurns.map((turn) => (
            <div key={turn.id} className="pb-2">
              <div className="flex items-center gap-2 px-1 py-1.5 text-app-11 text-subtle">
                <span className="h-1.5 w-1.5 rounded-full bg-subtle" />
                <span>Turn {turn.index}</span>
                {turn.durationMs > 0 ? <span>· {formatDuration(turn.durationMs)}</span> : null}
              </div>
              <div className="space-y-0.5">
                {turn.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => selectRow(row)}
                    className={`flex w-full items-start gap-3 rounded px-2 py-1 text-left hover:bg-surface-hover ${
                      row.id === selectedRowId ? "bg-surface-hover" : ""
                    }`}
                  >
                    <span
                      className={`mt-px w-20 shrink-0 rounded px-1 py-px text-center text-app-10 font-semibold uppercase ${BADGE_STYLES[row.badge]}`}
                    >
                      {row.badge}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate leading-5 ${
                        row.badge === "ERROR" ? "text-danger" : "text-muted"
                      }`}
                    >
                      {row.summary}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {visibleTurns.length === 0 ? (
            <div className="py-10 text-center text-subtle">没有匹配的记录</div>
          ) : null}
        </div>
        {selected ? (
          <div className="flex w-[24rem] shrink-0 flex-col border-l border-border bg-bg">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <span
                className={`rounded px-1.5 py-px text-app-10 font-semibold uppercase ${BADGE_STYLES[selected.row.badge]}`}
              >
                {selected.row.badge}
              </span>
              <span className="text-app-11 text-subtle">
                Turn {selected.turn.index} · Step {selected.step}
              </span>
              <button
                type="button"
                aria-label="关闭详情"
                onClick={() => setSelectedRowId(null)}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex shrink-0 gap-3 border-b border-border px-3 pt-2 text-app-12">
              {(
                [
                  { key: "raw", label: "Raw" },
                  ...(selected.row.payload !== undefined
                    ? [{ key: "payload" as const, label: "Payload" }]
                    : []),
                  ...(selected.row.result !== undefined
                    ? [{ key: "result" as const, label: "Result" }]
                    : []),
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setDetailTab(tab.key)}
                  className={`border-b-2 px-1 pb-1.5 transition ${
                    detailTab === tab.key
                      ? "border-brand text-fg"
                      : "border-transparent text-muted hover:text-fg"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-app-12 leading-relaxed text-muted">
                {detailTab === "raw"
                  ? JSON.stringify(selected.row.raw, null, 2)
                  : detailTab === "result"
                    ? selected.row.result
                    : prettyJson(selected.row.payload ?? "")}
              </pre>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
