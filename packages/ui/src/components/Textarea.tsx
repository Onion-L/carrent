import type { TextareaHTMLAttributes } from "react";

import { cn } from "../lib/cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg shadow-sm",
        "placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
