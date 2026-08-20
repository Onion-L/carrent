export type ChatQuestionSource = "core";

// Carrent adds this automatic free-text choice; Agent Core never supplies it.
export const CHAT_QUESTION_OTHER_OPTION_ID = "other";

export type ChatQuestionOption = {
  optionId: string;
  label: string;
  description?: string;
};

export type ChatQuestionItem = {
  header: string;
  question: string;
  options: ChatQuestionOption[];
  multiSelect: boolean;
};

export type ChatQuestionRequest = {
  id: string;
  runId: string;
  requestKey?: string;
  threadId: string;
  provider: "core";
  source: ChatQuestionSource;
  questions: ChatQuestionItem[];
  skipOptionId?: string;
  createdAt: string;
};

// One answer per question in the request, addressed by index so long question
// texts never need to round-trip. `customText` carries the automatic Other
// answer and is only meaningful when optionIds contains
// CHAT_QUESTION_OTHER_OPTION_ID.
export type ChatQuestionAnswer = {
  questionIndex: number;
  optionIds: string[];
  customText?: string;
};

export type ChatQuestionResponse =
  | {
      questionId: string;
      runId: string;
      action: "submit";
      answers: ChatQuestionAnswer[];
    }
  | {
      questionId: string;
      runId: string;
      action: "skip";
    };
