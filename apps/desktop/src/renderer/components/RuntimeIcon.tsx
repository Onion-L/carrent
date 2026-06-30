import { OpenAIIcon } from "./icons/OpenAIIcon";
import { ClaudeIcon } from "./icons/ClaudeIcon";
import { KimiIcon } from "./icons/KimiIcon";
import { PiIcon } from "./icons/PiIcon";

export function RuntimeIcon({
  name,
  size = "md",
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
}) {
  const key = name.toLowerCase();
  const sizeClasses = {
    xs: "h-4 w-4 rounded",
    sm: "h-8 w-8 rounded-lg",
    md: "h-10 w-10 rounded-xl",
    lg: "h-12 w-12 rounded-xl",
  };
  const iconSizes = {
    xs: "h-2.5 w-2.5",
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  if (key.includes("codex") || key.includes("openai")) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-surface-raised text-fg ${sizeClasses[size]}`}
      >
        <OpenAIIcon className={iconSizes[size]} />
      </div>
    );
  }
  if (key.includes("kimi")) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-surface-raised ${sizeClasses[size]}`}
      >
        <KimiIcon className={iconSizes[size]} />
      </div>
    );
  }
  if (key.includes("claude")) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-surface-raised ${sizeClasses[size]}`}
      >
        <ClaudeIcon className={iconSizes[size]} />
      </div>
    );
  }
  if (key.includes("pi")) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-surface-raised text-fg ${sizeClasses[size]}`}
      >
        <PiIcon className={iconSizes[size]} />
      </div>
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-surface-raised text-[15px] font-bold text-fg ${sizeClasses[size]}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
