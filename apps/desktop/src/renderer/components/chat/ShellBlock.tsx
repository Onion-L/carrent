import { CheckCircle2, CircleDashed, Terminal, XCircle } from "lucide-react";
import { useState } from "react";
import type { MessagePart } from "../../mock/uiShellData";

type ShellPart = Extract<MessagePart, { type: "shell" }>;

function getStatusMeta(status: ShellPart["status"]) {
  switch (status) {
    case "completed":
      return {
        label: "completed",
        icon: CheckCircle2,
        className: "text-success",
      };
    case "failed":
      return {
        label: "failed",
        icon: XCircle,
        className: "text-danger",
      };
    case "running":
      return {
        label: "running",
        icon: CircleDashed,
        className: "text-warning",
      };
  }
}

export function getInitialShellBlockExpanded() {
  return false;
}

export function ShellBlock({ shell }: { shell: ShellPart }) {
  const [expanded, setExpanded] = useState(getInitialShellBlockExpanded);
  const status = getStatusMeta(shell.status);
  const StatusIcon = status.icon;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 bg-surface-raised px-3 py-2 text-left transition hover:bg-surface-hover"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-fg">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="shrink-0">Shell</span>
        </div>
        <div className={`flex shrink-0 items-center gap-1.5 text-[11px] ${status.className}`}>
          <StatusIcon
            className={`h-3.5 w-3.5 ${shell.status === "running" ? "animate-spin" : ""}`}
          />
          <span>{status.label}</span>
        </div>
      </button>
      {expanded && (
        <div className="space-y-2 px-3 py-3 font-mono text-[12px] leading-relaxed">
          <pre className="whitespace-pre-wrap break-words text-fg">
            <span className="text-muted">$ </span>
            {shell.command}
          </pre>
          {shell.output ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-code-bg p-3 text-muted">
              {shell.output}
            </pre>
          ) : (
            shell.status === "running" && <div className="text-[12px] text-subtle">Running...</div>
          )}
        </div>
      )}
    </div>
  );
}
