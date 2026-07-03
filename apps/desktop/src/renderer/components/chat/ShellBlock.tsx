import { CheckCircle2, ChevronDown, CircleDashed, XCircle } from "lucide-react";
import { useState } from "react";
import type { MessagePart } from "../../mock/uiShellData";

type ShellPart = Extract<MessagePart, { type: "shell" }>;

function getStatusMeta(status: ShellPart["status"]) {
  switch (status) {
    case "completed":
      return {
        label: "Ran command",
        icon: CheckCircle2,
        className: "text-subtle",
      };
    case "failed":
      return {
        label: "Command failed",
        icon: XCircle,
        className: "text-danger",
      };
    case "running":
      return {
        label: "Running command",
        icon: CircleDashed,
        className: "text-muted",
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
    <div className="py-1">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex w-full items-center gap-2 text-left text-[13px] text-subtle transition hover:text-muted"
        aria-expanded={expanded}
      >
        <StatusIcon
          className={`h-3.5 w-3.5 shrink-0 ${status.className} ${
            shell.status === "running" ? "animate-spin" : ""
          }`}
        />
        <span className={`min-w-0 truncate font-medium ${status.className}`}>{status.label}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 border-l border-border pl-5 font-mono text-[12px] leading-relaxed">
          <pre className="whitespace-pre-wrap break-words text-muted">
            <span className="text-muted">$ </span>
            {shell.command}
          </pre>
          {shell.output ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-code-bg p-3 text-muted">
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
