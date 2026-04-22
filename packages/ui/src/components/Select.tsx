import type { SelectHTMLAttributes } from "react";

import { cn } from "../lib/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg shadow-sm",
        "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
