import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-bg px-6 py-10 text-center",
        className,
      )}
    >
      <div className="mx-auto max-w-md space-y-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted">{description}</p>
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  );
}
