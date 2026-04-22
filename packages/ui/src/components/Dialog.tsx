import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { Button } from "./Button";

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  className?: string;
}

export function Dialog({
  open,
  title,
  description,
  children,
  actions,
  onClose,
  className,
}: DialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/35 px-4">
      <div
        aria-modal="true"
        className={cn(
          "w-full max-w-lg rounded-lg border border-border bg-surface shadow-xl",
          className,
        )}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            {description ? (
              <p className="text-sm text-muted">{description}</p>
            ) : null}
          </div>
          {onClose ? (
            <Button
              aria-label="Close dialog"
              onClick={onClose}
              size="sm"
              variant="ghost"
            >
              Close
            </Button>
          ) : null}
        </div>
        <div className="p-6">{children}</div>
        {actions ? (
          <div className="flex justify-end gap-3 border-t border-border p-6">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
