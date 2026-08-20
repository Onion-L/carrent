import { KeyRound } from "lucide-react";

const sizes = { xs: "h-3.5 w-3.5", sm: "h-4 w-4", lg: "h-6 w-6" } as const;

export function ProviderIcon({ size = "sm" }: { name?: string; size?: keyof typeof sizes }) {
  return (
    <span className="flex shrink-0 items-center justify-center text-muted">
      <KeyRound className={sizes[size]} />
    </span>
  );
}
