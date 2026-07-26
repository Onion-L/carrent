import { CircleAlert } from "lucide-react";

import type { MessagePart } from "../../mock/uiShellData";

export type ErrorPart = Extract<MessagePart, { type: "error" }>;

export function ErrorBlock({ part }: { part: ErrorPart }) {
  return (
    <section className="overflow-hidden rounded-lg border border-danger/30 bg-danger/5">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        <span className="min-w-0 flex-1 text-app-13 text-danger">{part.message}</span>
      </div>
    </section>
  );
}
