import { ListChecks } from "lucide-react";

import type { MessagePart } from "../../mock/uiShellData";
import { MarkdownContent } from "./MarkdownContent";

export type PlanReviewPart = Extract<MessagePart, { type: "plan_review" }>;

export function getPlanReviewStatusLabel(_review: PlanReviewPart) {
  return "Plan";
}

export function PlanReviewBlock({ review }: { review: PlanReviewPart }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-strong bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <ListChecks className="h-4 w-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-app-13 font-medium text-fg">
          {getPlanReviewStatusLabel(review)}
        </span>
      </div>

      <div className="max-h-[28rem] overflow-y-auto px-4 py-3">
        <MarkdownContent>{review.content}</MarkdownContent>
      </div>
    </section>
  );
}
