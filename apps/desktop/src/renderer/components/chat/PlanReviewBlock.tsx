import { Check, CircleSlash, ListChecks, Pencil, TriangleAlert } from "lucide-react";

import type { MessagePart } from "../../../shared/threadContent";
import { MarkdownContent } from "./MarkdownContent";

export type PlanReviewPart = Extract<MessagePart, { type: "plan_review" }>;

export function getPlanReviewStatusLabel(review: PlanReviewPart) {
  switch (review.status) {
    case "pending":
      return "Plan ready";
    case "approved":
      return "Plan approved";
    case "revision-requested":
      return "Revision requested";
    case "rejected":
      return "Plan closed";
    case "interrupted":
      return "Plan interrupted";
  }
}

function PlanStatusIcon({ review }: { review: PlanReviewPart }) {
  if (review.status === "approved") return <Check className="h-4 w-4 shrink-0 text-success" />;
  if (review.status === "revision-requested") {
    return <Pencil className="h-4 w-4 shrink-0 text-muted" />;
  }
  if (review.status === "rejected") {
    return <CircleSlash className="h-4 w-4 shrink-0 text-muted" />;
  }
  if (review.status === "interrupted") {
    return <TriangleAlert className="h-4 w-4 shrink-0 text-warning" />;
  }
  return <ListChecks className="h-4 w-4 shrink-0 text-muted" />;
}

export function PlanReviewBlock({ review }: { review: PlanReviewPart }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-strong bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <PlanStatusIcon review={review} />
        <span className="min-w-0 flex-1 truncate text-app-13 font-medium text-fg">
          {getPlanReviewStatusLabel(review)}
        </span>
        {review.status === "approved" &&
        review.selectedOptionName &&
        review.selectedOptionId !== "plan_approve" ? (
          <span className="max-w-56 truncate text-app-11 text-subtle">
            {review.selectedOptionName}
          </span>
        ) : null}
      </div>

      <div className="max-h-[28rem] overflow-y-auto px-4 py-3">
        <MarkdownContent>{review.content}</MarkdownContent>
      </div>
    </section>
  );
}
