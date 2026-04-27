import {
  DEFAULT_RUNTIME_MODE,
  getRuntimeModeLabel,
  type RuntimeMode,
} from "../../../shared/runtimeMode";

type ChatHeaderProps = {
  title?: string;
  runtimeMode?: RuntimeMode;
  onRuntimeModeChange?: (mode: RuntimeMode) => void;
  isRunning?: boolean;
};

export function ChatHeader({ title, runtimeMode, onRuntimeModeChange, isRunning }: ChatHeaderProps) {
  return (
    <header
      className="drag-region flex shrink-0 items-center justify-between px-4"
      style={{ height: "env(titlebar-area-height, 38px)" }}
    >
      <h1 className="text-[14px] font-medium text-[#888]">{title ?? "New Chat"}</h1>
      {onRuntimeModeChange ? (
        <div className="flex items-center gap-2">
          <select
            value={runtimeMode ?? DEFAULT_RUNTIME_MODE}
            onChange={(event) => onRuntimeModeChange(event.target.value as RuntimeMode)}
            disabled={isRunning}
            className="no-drag rounded-md border border-[#333] bg-[#202020] px-2 py-1 text-[12px] text-[#aaa] outline-none disabled:opacity-40"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            title="Runtime permissions"
          >
            <option value="approval-required">
              {getRuntimeModeLabel("approval-required")}
            </option>
            <option value="auto-accept-edits">
              {getRuntimeModeLabel("auto-accept-edits")}
            </option>
            <option value="full-access">{getRuntimeModeLabel("full-access")} (danger)</option>
          </select>
          {isRunning ? (
            <span className="text-[10px] text-[#666]">Applies next turn</span>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
