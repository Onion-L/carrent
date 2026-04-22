import type { InputHTMLAttributes } from "react";

import { cn } from "../lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg shadow-sm",
        "placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
