import { describe, expect, it } from "bun:test";

import {
  QuestionAlreadyPendingError,
  QUESTION_DISMISSED_NOTE,
  QUESTION_MCP_SERVER_NAME,
  startQuestionMcpServer,
  type SessionQuestionInput,
  type SessionQuestionToolResult,
} from "./questionMcpServer";

type JsonObject = Record<string, unknown>;

const VALID_INPUT = {
  questions: [
    {
      header: "Language",
      question: "Which language should the new module use?",
      options: [
        { label: "TypeScript", description: "Use TypeScript for the new module" },
        { label: "JavaScript" },
      ],
      multi_select: false,
    },
  ],
};

async function rpc(url: string, method: string, params: JsonObject = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `rpc-${method}`, method, params }),
  });
  return { status: response.status, body: (await response.json()) as JsonObject };
}

function callAskUserQuestion(url: string, args: unknown) {
  return rpc(url, "tools/call", { name: "ask_user_question", arguments: args });
}

function resultObject(response: JsonObject) {
  return response.result as JsonObject;
}

async function startTestServer(options?: {
  onAskUserQuestion?: (input: SessionQuestionInput) => Promise<SessionQuestionToolResult>;
}) {
  const calls: SessionQuestionInput[] = [];
  const handle = await startQuestionMcpServer({
    token: "question-test",
    onAskUserQuestion: async (input) => {
      calls.push(input);
      if (options?.onAskUserQuestion) {
        return options.onAskUserQuestion(input);
      }
      return {
        answers: Object.fromEntries(
          input.questions.map((question) => [question.question, question.options[0]!.label]),
        ),
      };
    },
  });
  return { handle, calls };
}

describe("startQuestionMcpServer", () => {
  it("advertises only ask_user_question with a 1-4 question single/multi-select schema", async () => {
    const { handle } = await startTestServer();
    try {
      const { body } = await rpc(handle.mcpServer.url, "tools/list");

      const tools = resultObject(body).tools as JsonObject[];
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({ name: "ask_user_question" });
      const description = String(tools[0]!.description);
      expect(description).toContain("AskUserQuestion");
      expect(description.toLowerCase()).toContain("prefer");
      const schema = tools[0]!.inputSchema as JsonObject;
      expect(JSON.stringify(schema)).not.toContain("background");
      const questions = (schema.properties as JsonObject).questions as JsonObject;
      expect(questions.minItems).toBe(1);
      expect(questions.maxItems).toBe(4);
      const item = questions.items as JsonObject;
      const multiSelect = (item.properties as JsonObject).multi_select as JsonObject;
      expect(multiSelect.type).toBe("boolean");
      expect(multiSelect.enum).toBeUndefined();
      const options = (item.properties as JsonObject).options as JsonObject;
      expect(options.minItems).toBe(2);
      expect(options.maxItems).toBe(4);
    } finally {
      await handle.close();
    }
  });

  it("requires the unguessable token and the MCP path", async () => {
    const { handle } = await startTestServer();
    try {
      const badToken = await fetch(handle.mcpServer.url.replace("question-test", "wrong"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(badToken.status).toBe(401);

      const badPath = await fetch(handle.mcpServer.url.replace("/mcp", "/other"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(badPath.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it("names the server carrent_session", async () => {
    const { handle } = await startTestServer();
    try {
      expect(handle.mcpServer).toMatchObject({
        id: QUESTION_MCP_SERVER_NAME,
        name: QUESTION_MCP_SERVER_NAME,
        type: "http",
      });

      const { body } = await rpc(handle.mcpServer.url, "initialize", {
        protocolVersion: "2024-11-05",
      });
      expect(resultObject(body).serverInfo).toMatchObject({ name: QUESTION_MCP_SERVER_NAME });
    } finally {
      await handle.close();
    }
  });

  it("keeps the tool call pending until the handler settles and returns Kimi-shaped answers", async () => {
    let settle: ((result: SessionQuestionToolResult) => void) | null = null;
    const { handle, calls } = await startTestServer({
      onAskUserQuestion: (input) =>
        new Promise((resolve) => {
          settle = resolve;
          void input;
        }),
    });
    try {
      let httpSettled = false;
      const pendingResponse = callAskUserQuestion(handle.mcpServer.url, VALID_INPUT).then(
        (value) => {
          httpSettled = true;
          return value;
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(httpSettled).toBe(false);

      settle!({ answers: { "Which language should the new module use?": "TypeScript" } });
      const { body } = await pendingResponse;

      expect(calls).toEqual([
        {
          questions: [
            {
              header: "Language",
              question: "Which language should the new module use?",
              options: [
                { label: "TypeScript", description: "Use TypeScript for the new module" },
                { label: "JavaScript" },
              ],
              multiSelect: false,
            },
          ],
        },
      ]);
      const result = resultObject(body);
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        answers: { "Which language should the new module use?": "TypeScript" },
      });
      const content = result.content as JsonObject[];
      expect(JSON.parse(String(content[0]!.text))).toEqual({
        answers: { "Which language should the new module use?": "TypeScript" },
      });
    } finally {
      await handle.close();
    }
  });

  it("returns the dismissal note shape used by Kimi for skipped questions", async () => {
    const { handle } = await startTestServer({
      onAskUserQuestion: async () => ({ answers: {}, note: QUESTION_DISMISSED_NOTE }),
    });
    try {
      const { body } = await callAskUserQuestion(handle.mcpServer.url, VALID_INPUT);

      expect(resultObject(body).structuredContent).toEqual({
        answers: {},
        note: "User dismissed the question without answering.",
      });
    } finally {
      await handle.close();
    }
  });

  it("preserves headers, descriptions, and multi-select across several questions", async () => {
    const { handle, calls } = await startTestServer();
    try {
      const multiInput = {
        questions: [
          VALID_INPUT.questions[0],
          {
            header: "Features",
            question: "Which features should the module include?",
            options: [
              { label: "Logging", description: "Structured logs" },
              { label: "Metrics", description: "Runtime metrics" },
              { label: "Tracing" },
            ],
            multi_select: true,
          },
        ],
      };

      const { body } = await callAskUserQuestion(handle.mcpServer.url, multiInput);

      expect(calls).toEqual([
        {
          questions: [
            {
              header: "Language",
              question: "Which language should the new module use?",
              options: [
                { label: "TypeScript", description: "Use TypeScript for the new module" },
                { label: "JavaScript" },
              ],
              multiSelect: false,
            },
            {
              header: "Features",
              question: "Which features should the module include?",
              options: [
                { label: "Logging", description: "Structured logs" },
                { label: "Metrics", description: "Runtime metrics" },
                { label: "Tracing" },
              ],
              multiSelect: true,
            },
          ],
        },
      ]);
      expect(resultObject(body).structuredContent).toEqual({
        answers: {
          "Which language should the new module use?": "TypeScript",
          "Which features should the module include?": "Logging",
        },
      });
    } finally {
      await handle.close();
    }
  });

  it("rejects unsupported input shapes with structured tool errors instead of degrading", async () => {
    const { handle, calls } = await startTestServer();
    try {
      const unsupported: Array<[string, unknown]> = [
        [
          "five questions",
          {
            questions: [
              VALID_INPUT.questions[0],
              {
                header: "Two",
                question: "Question two?",
                options: [{ label: "A" }, { label: "B" }],
              },
              {
                header: "Three",
                question: "Question three?",
                options: [{ label: "A" }, { label: "B" }],
              },
              {
                header: "Four",
                question: "Question four?",
                options: [{ label: "A" }, { label: "B" }],
              },
              {
                header: "Five",
                question: "Question five?",
                options: [{ label: "A" }, { label: "B" }],
              },
            ],
          },
        ],
        ["zero questions", { questions: [] }],
        [
          "duplicate question texts",
          {
            questions: [
              VALID_INPUT.questions[0],
              {
                header: "Again",
                question: VALID_INPUT.questions[0]!.question,
                options: [{ label: "A" }, { label: "B" }],
              },
            ],
          },
        ],
        [
          "non-boolean multi-select",
          { questions: [{ ...VALID_INPUT.questions[0], multi_select: "yes" }] },
        ],
        [
          "too few options",
          {
            questions: [{ ...VALID_INPUT.questions[0], options: [{ label: "Only one" }] }],
          },
        ],
        [
          "too many options",
          {
            questions: [
              {
                ...VALID_INPUT.questions[0],
                options: [
                  { label: "A" },
                  { label: "B" },
                  { label: "C" },
                  { label: "D" },
                  { label: "E" },
                ],
              },
            ],
          },
        ],
        [
          "missing question text",
          { questions: [{ header: "Language", options: [{ label: "A" }, { label: "B" }] }] },
        ],
        [
          "agent-supplied Other option",
          {
            questions: [
              {
                ...VALID_INPUT.questions[0],
                options: [{ label: "TypeScript" }, { label: "Other" }],
              },
            ],
          },
        ],
        [
          "duplicate option labels",
          {
            questions: [
              {
                ...VALID_INPUT.questions[0],
                options: [{ label: "Same" }, { label: "Same" }],
              },
            ],
          },
        ],
        ["background questions", { ...VALID_INPUT, background: true }],
        ["missing questions", {}],
      ];

      for (const [name, args] of unsupported) {
        const { body } = await callAskUserQuestion(handle.mcpServer.url, args);
        const result = resultObject(body);
        if (result.isError !== true) {
          throw new Error(`Expected a structured tool error for: ${name}`);
        }
        expect(result.structuredContent).toMatchObject({
          error: { code: "invalid_question_input" },
        });
      }
      expect(calls).toEqual([]);
    } finally {
      await handle.close();
    }
  });

  it("rejects unknown tools with a structured tool error", async () => {
    const { handle } = await startTestServer();
    try {
      const { body } = await rpc(handle.mcpServer.url, "tools/call", {
        name: "list_skills",
        arguments: {},
      });

      expect(resultObject(body)).toMatchObject({
        isError: true,
        structuredContent: { error: { code: "unknown_tool" } },
      });
    } finally {
      await handle.close();
    }
  });

  it("maps an already-pending rejection to a structured question_already_pending error", async () => {
    const { handle } = await startTestServer({
      onAskUserQuestion: () => Promise.reject(new QuestionAlreadyPendingError()),
    });
    try {
      const { body } = await callAskUserQuestion(handle.mcpServer.url, VALID_INPUT);

      expect(resultObject(body)).toMatchObject({
        isError: true,
        structuredContent: { error: { code: "question_already_pending" } },
      });
    } finally {
      await handle.close();
    }
  });

  it("answers a pending call with a structured error when the server closes", async () => {
    const { handle } = await startTestServer({
      onAskUserQuestion: () => new Promise(() => {}),
    });
    const pendingResponse = callAskUserQuestion(handle.mcpServer.url, VALID_INPUT);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await handle.close();

    const { body } = await pendingResponse;
    expect(resultObject(body)).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "server_closed" } },
    });
  });
});
