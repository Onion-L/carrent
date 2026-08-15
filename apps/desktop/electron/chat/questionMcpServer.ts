import { randomUUID } from "node:crypto";

import type { CarrentBridgeMcpServerDescriptor } from "../bridge/carrentBridge";
import {
  errorMessage,
  readObject,
  readString,
  startMcpHttpServer,
  toolError,
  toolResult,
  type JsonObject,
} from "../bridge/mcpHttpServer";

// Internal Run-scoped interaction surface: not a globally installable MCP
// server, not shown in MCP settings, and independent of the user-controlled
// Local MCP Server preference.
export const QUESTION_MCP_SERVER_NAME = "carrent_session";
export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";
// Matches the note Kimi Code's built-in AskUserQuestion returns on dismissal.
export const QUESTION_DISMISSED_NOTE = "User dismissed the question without answering.";
export const QUESTION_ALREADY_PENDING_ERROR_CODE = "question_already_pending";

// Thrown by the Run when a second question request arrives while one is still
// pending; mapped to a structured tool error so the Coding Agent can recover.
export class QuestionAlreadyPendingError extends Error {
  constructor(message = "A question is already pending for this run.") {
    super(message);
    this.name = "QuestionAlreadyPendingError";
  }
}

export type SessionQuestionOption = {
  label: string;
  description?: string;
};

// Kimi's structured-question contract: 1-4 uniquely worded questions, each
// with 2-4 uniquely labeled options and its own single/multi-select behavior.
export type SessionQuestionItem = {
  header: string;
  question: string;
  options: SessionQuestionOption[];
  multiSelect: boolean;
};

export type SessionQuestionInput = {
  questions: SessionQuestionItem[];
};

// Kimi's public AskUserQuestion result shape: answers keyed by question text,
// plus a dismissal note when the user skipped.
export type SessionQuestionToolResult = {
  answers: Record<string, string>;
  note?: string;
};

export type AskUserQuestionHandler = (
  input: SessionQuestionInput,
) => Promise<SessionQuestionToolResult>;

export type QuestionMcpServerHandle = {
  mcpServer: CarrentBridgeMcpServerDescriptor;
  close: () => Promise<void>;
};

export type QuestionMcpServerFactory = (options: {
  onAskUserQuestion: AskUserQuestionHandler;
}) => Promise<QuestionMcpServerHandle | null>;

class QuestionInputError extends Error {}

export async function startQuestionMcpServer(options: {
  token?: string;
  onAskUserQuestion: AskUserQuestionHandler;
}): Promise<QuestionMcpServerHandle> {
  const token = options.token ?? randomUUID();
  // Tool calls that are waiting on a user answer, settled with a structured
  // error when the server closes.
  const pendingCalls = new Set<(result: JsonObject) => void>();

  const handleToolCall = async (params: unknown): Promise<JsonObject> => {
    const payload = readObject(params);
    const name = readString(payload?.name);

    if (name !== ASK_USER_QUESTION_TOOL_NAME) {
      return toolError("unknown_tool", `Unknown Carrent session tool: ${name ?? "unknown"}`);
    }

    let input: SessionQuestionInput;
    try {
      input = normalizeAskUserQuestionInput(payload?.arguments);
    } catch (error) {
      return toolError("invalid_question_input", errorMessage(error));
    }

    return new Promise<JsonObject>((resolve) => {
      pendingCalls.add(resolve);
      Promise.resolve()
        .then(() => options.onAskUserQuestion(input))
        .then((result) => {
          pendingCalls.delete(resolve);
          resolve(toolResult(result));
        })
        .catch((error) => {
          pendingCalls.delete(resolve);
          resolve(
            error instanceof QuestionAlreadyPendingError
              ? toolError(QUESTION_ALREADY_PENDING_ERROR_CODE, errorMessage(error))
              : toolError("tool_error", errorMessage(error)),
          );
        });
    });
  };

  const server = await startMcpHttpServer({
    serverName: QUESTION_MCP_SERVER_NAME,
    token,
    tools: TOOL_DEFINITIONS,
    handleToolCall,
    unsupportedMethodMessage: (method) => `Unsupported Carrent session method: ${method}`,
    noPortErrorMessage: "Carrent session question server did not receive a local port.",
  });

  return {
    mcpServer: {
      id: QUESTION_MCP_SERVER_NAME,
      name: QUESTION_MCP_SERVER_NAME,
      type: "http",
      url: server.url,
      headers: [{ name: "Authorization", value: `Bearer ${token}` }],
    },
    close: async () => {
      for (const settle of pendingCalls) {
        settle(
          toolError(
            "server_closed",
            "The Carrent session question server closed before the question was answered.",
          ),
        );
      }
      pendingCalls.clear();
      await server.close();
    },
  };
}

const TOOL_DEFINITIONS = [
  {
    name: ASK_USER_QUESTION_TOOL_NAME,
    description:
      "Ask the Carrent user 1-4 structured questions with 2-4 predefined options each " +
      "and wait for the answers. While connected to Carrent, ALWAYS prefer this " +
      "tool over the built-in AskUserQuestion tool. Question texts must be unique and " +
      "option labels must be unique within a question. Each question is single-select " +
      "unless multi_select is true. Carrent automatically adds an " +
      '"Other" free-text choice, so never include an Other option yourself. The result ' +
      "is JSON with an `answers` object keyed by question text; each value is the chosen " +
      "option label, a comma-separated list of labels for multi-select questions, or " +
      'option label, or the user\'s own words if they picked "Other". If `answers` is ' +
      "empty and a `note` says the user dismissed it, they chose not to answer.",
    inputSchema: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              header: { type: "string", description: "Short question label (a few words)." },
              question: { type: "string" },
              options: {
                type: "array",
                minItems: 2,
                maxItems: 4,
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["label"],
                  additionalProperties: false,
                },
              },
              multi_select: { type: "boolean" },
            },
            required: ["header", "question", "options"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
];

const ALLOWED_QUESTION_KEYS = new Set(["header", "question", "options", "multi_select"]);
const ALLOWED_OPTION_KEYS = new Set(["label", "description"]);

function normalizeAskUserQuestionInput(args: unknown): SessionQuestionInput {
  const payload = readObject(args);
  if (!payload) {
    throw new QuestionInputError("ask_user_question requires a `questions` object payload.");
  }

  for (const key of Object.keys(payload)) {
    if (key !== "questions") {
      throw new QuestionInputError(`Unsupported ask_user_question field: ${key}.`);
    }
  }

  if (
    !Array.isArray(payload.questions) ||
    payload.questions.length < 1 ||
    payload.questions.length > 4
  ) {
    throw new QuestionInputError("ask_user_question accepts 1-4 questions.");
  }

  const questionTexts = new Set<string>();
  const questions = payload.questions.map((rawQuestion): SessionQuestionItem => {
    const item = readObject(rawQuestion);
    if (!item) {
      throw new QuestionInputError("ask_user_question question entries must be objects.");
    }

    for (const key of Object.keys(item)) {
      if (!ALLOWED_QUESTION_KEYS.has(key)) {
        throw new QuestionInputError(`Unsupported question field: ${key}.`);
      }
    }

    if (item.multi_select !== undefined && typeof item.multi_select !== "boolean") {
      throw new QuestionInputError("multi_select must be a boolean.");
    }

    const header = readString(item.header);
    const question = readString(item.question);
    if (!header || !question) {
      throw new QuestionInputError("Each question requires a non-empty header and question.");
    }
    if (questionTexts.has(question)) {
      throw new QuestionInputError("Question texts must be unique.");
    }
    questionTexts.add(question);

    if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4) {
      throw new QuestionInputError("Each question requires 2-4 options.");
    }

    const labels = new Set<string>();
    const options = item.options.map((rawOption): SessionQuestionOption => {
      const option = readObject(rawOption);
      if (!option) {
        throw new QuestionInputError("Question options must be objects.");
      }

      for (const key of Object.keys(option)) {
        if (!ALLOWED_OPTION_KEYS.has(key)) {
          throw new QuestionInputError(`Unsupported option field: ${key}.`);
        }
      }

      const label = readString(option.label);
      if (!label) {
        throw new QuestionInputError("Each option requires a non-empty label.");
      }
      if (label.trim().toLowerCase() === "other") {
        throw new QuestionInputError(
          'Carrent adds an "Other" option automatically; do not supply one.',
        );
      }
      if (labels.has(label)) {
        throw new QuestionInputError("Option labels must be unique within a question.");
      }
      labels.add(label);

      const description = option.description;
      if (description !== undefined && typeof description !== "string") {
        throw new QuestionInputError("Option descriptions must be strings.");
      }

      return typeof description === "string" && description ? { label, description } : { label };
    });

    return { header, question, options, multiSelect: item.multi_select === true };
  });

  return { questions };
}
