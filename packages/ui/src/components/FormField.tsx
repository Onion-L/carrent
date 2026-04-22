import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export interface FormFieldProps {
  label: string;
  helperText?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({
  label,
  helperText,
  error,
  children,
  className,
}: FormFieldProps) {
  return (
    <label className={cn("grid gap-2", className)}>
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
      {error ? (
        <span className="text-sm text-danger">{error}</span>
      ) : helperText ? (
        <span className="text-sm text-muted">{helperText}</span>
      ) : null}
    </label>
  );
}
