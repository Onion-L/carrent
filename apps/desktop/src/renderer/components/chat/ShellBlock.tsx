import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Terminal,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import type { MessagePart } from "../../mock/uiShellData";

type ShellPart = Extract<MessagePart, { type: "shell" }>;

function getStatusMeta(status: ShellPart["status"]) {
  switch (status) {
    case "completed":
      return {
        label: "completed",
        icon: CheckCircle2,
        className: "text-[#6ecb8b]",
      };
    case "failed":
      return {
        label: "failed",
        icon: XCircle,
        className: "text-[#f06f6f]",
      };
    case "running":
      return {
        label: "running",
        icon: CircleDashed,
        className: "text-[#d7aa55]",
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
    <div className="overflow-hidden rounded-xl border border-[#303030] bg-[#151515]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between gap-3 bg-[#1c1c1c] px-3 py-2 text-left transition hover:bg-[#222]"
        aria-expanded={expanded}
      >
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-[#d5d5d5]">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-[#888]" />
          <span className="shrink-0">Shell</span>
        </div>
        <div
          className={`flex shrink-0 items-center gap-1.5 text-[11px] ${status.className}`}
        >
          <StatusIcon
            className={`h-3.5 w-3.5 ${shell.status === "running" ? "animate-spin" : ""}`}
          />
          <span>{status.label}</span>
        </div>
      </button>
      {expanded && (
        <div className="space-y-2 px-3 py-3 font-mono text-[12px] leading-relaxed">
          <pre className="whitespace-pre-wrap break-words text-[#cfcfcf]">
            <span className="text-[#777]">$ </span>
            {shell.command}
          </pre>
          {shell.output ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#101010] p-3 text-[#a9a9a9]">
              {shell.output}
            </pre>
          ) : (
            shell.status === "running" && (
              <div className="text-[12px] text-[#666]">Running...</div>
            )
          )}
        </div>
      )}
    </div>
  );
}
