import {
  CHAT_QUESTION_OTHER_OPTION_ID,
  type ChatQuestionAnswer,
  type ChatQuestionRequest,
} from "../../shared/chatQuestions";

export type QuestionDraft = {
  optionIds: string[];
  otherText: string;
};

export type QuestionDraftState = {
  questionIndex: number;
  drafts: QuestionDraft[];
};

// Draft answers per pending question, keyed by question id and kept outside
// React: leaving a Thread unmounts the Composer, and coming back must restore
// the same question index, selections, and Other text. Entries are cleared
// when the question is resolved or interrupted.
const stateByQuestionId = new Map<string, QuestionDraftState>();

export function createQuestionDrafts(question: ChatQuestionRequest): QuestionDraft[] {
  return question.questions.map(() => ({ optionIds: [], otherText: "" }));
}

export function getQuestionDraftsFromAnswers(
  question: ChatQuestionRequest,
  answers: ChatQuestionAnswer[],
): QuestionDraft[] {
  const answersByIndex = new Map(answers.map((answer) => [answer.questionIndex, answer]));
  return question.questions.map((_, questionIndex) => {
    const answer = answersByIndex.get(questionIndex);
    return {
      optionIds: answer ? [...answer.optionIds] : [],
      otherText: answer?.customText ?? "",
    };
  });
}

function copyState(state: QuestionDraftState): QuestionDraftState {
  return {
    questionIndex: state.questionIndex,
    drafts: state.drafts.map((draft) => ({
      optionIds: [...draft.optionIds],
      otherText: draft.otherText,
    })),
  };
}

export function getQuestionDraftState(questionId: string): QuestionDraftState | null {
  const state = stateByQuestionId.get(questionId);
  return state ? copyState(state) : null;
}

export function setQuestionDraftState(questionId: string, state: QuestionDraftState): void {
  stateByQuestionId.set(questionId, copyState(state));
}

export function clearQuestionDraftState(questionId: string): void {
  stateByQuestionId.delete(questionId);
}

export type QuestionAnswerRecord = {
  questionIndex: number;
  labels: string[];
  customText?: string;
};

// Resolves a submitted draft into the compact history record: one entry per
// question with the labels of the selected options only. Labels come from the
// forwarded request, so ids the agent never offered are dropped rather than
// invented.
export function buildQuestionAnswerRecords(
  question: ChatQuestionRequest,
  drafts: QuestionDraft[],
): QuestionAnswerRecord[] {
  return question.questions.map((item, questionIndex) => {
    const draft = drafts[questionIndex] ?? { optionIds: [], otherText: "" };
    const labels = draft.optionIds.flatMap((optionId) => {
      if (optionId === CHAT_QUESTION_OTHER_OPTION_ID) {
        return ["Other"];
      }
      const option = item.options.find((entry) => entry.optionId === optionId);
      return option ? [option.label] : [];
    });
    return {
      questionIndex,
      labels,
      ...(draft.optionIds.includes(CHAT_QUESTION_OTHER_OPTION_ID) && draft.otherText
        ? { customText: draft.otherText }
        : {}),
    };
  });
}
