import { CircleHelp } from "lucide-react";

import type { MessagePart } from "../../mock/uiShellData";

export type QuestionPart = Extract<MessagePart, { type: "question" }>;

const STATUS_LABEL: Record<QuestionPart["status"], string> = {
  pending: "Waiting for answer",
  answered: "Answered",
  skipped: "Skipped",
  interrupted: "Interrupted",
};

const STATUS_CLASSNAME: Record<QuestionPart["status"], string> = {
  pending: "text-warning",
  answered: "text-success",
  skipped: "text-subtle",
  interrupted: "text-warning",
};

export function getQuestionStatusLabel(part: QuestionPart) {
  return STATUS_LABEL[part.status];
}

function formatAnswer(answer: NonNullable<QuestionPart["answers"]>[number]) {
  const labels = answer.labels.join(", ");
  if (answer.customText) {
    return labels ? `${labels}: "${answer.customText}"` : `"${answer.customText}"`;
  }
  return labels;
}

// Compact history record of a structured question: each asked question plus
// its final answer. Unselected options are never repeated. The live,
// actionable UI is the Composer QuestionPanel; pending parts stay hidden in
// the timeline and only settled or interrupted records render.
export function QuestionBlock({ part }: { part: QuestionPart }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-strong bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <CircleHelp className="h-4 w-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-app-13 font-medium text-fg">Question</span>
        <span className={`shrink-0 text-app-12 ${STATUS_CLASSNAME[part.status]}`}>
          {getQuestionStatusLabel(part)}
        </span>
      </div>

      <div className="flex flex-col gap-2.5 px-4 py-3">
        {part.questions.map((item, index) => {
          const answer = part.answers?.find((entry) => entry.questionIndex === index);
          return (
            <div key={index}>
              <div className="break-words text-app-13 font-medium text-fg">{item.question}</div>
              {answer ? (
                <div className="mt-0.5 break-words text-app-12 text-muted">
                  {formatAnswer(answer)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
