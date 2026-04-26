import { OpenAIIcon } from "./icons/OpenAIIcon";
import { ClaudeIcon } from "./icons/ClaudeIcon";

export function RuntimeIcon({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const key = name.toLowerCase();
  const sizeClasses = {
    sm: "h-8 w-8 rounded-lg",
    md: "h-10 w-10 rounded-xl",
    lg: "h-12 w-12 rounded-xl",
  };
  const iconSizes = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  if (key.includes("codex") || key.includes("openai")) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-[#252525] text-white ${sizeClasses[size]}`}
      >
        <OpenAIIcon className={iconSizes[size]} />
      </div>
    );
  }
  if (key.includes("claude")) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-[#252525] ${sizeClasses[size]}`}
      >
        <ClaudeIcon className={iconSizes[size]} />
      </div>
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-[#252525] text-[15px] font-bold text-[#ddd] ${sizeClasses[size]}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
