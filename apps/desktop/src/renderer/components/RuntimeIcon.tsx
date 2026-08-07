import { KimiIcon } from "./icons/KimiIcon";

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

  if (key.includes("kimi")) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center bg-surface-raised ${sizeClasses[size]}`}
      >
        <KimiIcon className={iconSizes[size]} />
      </div>
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-surface-raised text-app-15 font-bold text-fg ${sizeClasses[size]}`}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
