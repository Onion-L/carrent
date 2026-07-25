#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const scenario = args._[0] || "lifecycle";
const baseUrl = args.url || "http://127.0.0.1:58639/api/v1";
const sessionId = args.session;
const token = process.env.KIMI_KAP_TOKEN;
const outputDir = path.join(repoRoot, ".scratch/agent-runtime-roadmap/spike/output");
const transcriptPath = path.join(outputDir, `kap-${scenario}.jsonl`);

if (!sessionId) throw new Error("--session=<sessionId> is required");

let seq = 1;
let writeQueue = Promise.resolve();

await mkdir(outputDir, { recursive: true });
await writeFile(transcriptPath, "");

const summary = { scenario, baseUrl, sessionId, transcriptPath, result: null, error: null };

try {
  if (scenario === "lifecycle") summary.result = await runLifecycle();
  else if (scenario === "prepare-restart") summary.result = await runPrepareRestart();
  else if (scenario === "restart") summary.result = await runRestartCheck();
  else if (scenario === "interactions") summary.result = await runInteractions();
  else throw new Error(`Unknown scenario: ${scenario}`);
} catch (error) {
  summary.error = errorMessage(error);
  process.exitCode = 1;
}

await record("summary", summary);
console.log(JSON.stringify(summary, null, 2));

async function runLifecycle() {
  const snapshot = await request("GET", `/sessions/${sessionId}/snapshot`);
  const cursor = {
    seq: snapshot.data.as_of_seq,
    epoch: snapshot.data.epoch,
  };
  const ws = await connectEvents(cursor);

  try {
    const initial = await getGoal();
    if (initial.data !== null) {
      await updateGoal("cancel");
      await waitForGoal((goal) => goal === null);
    }

    await request("POST", `/sessions/${sessionId}/profile`, {
      agent_config: {
        goal_objective:
          "KAP_GOAL_PROBE: remain resumable across KAP restart; do not access files or run shell commands.",
      },
    });
    const created = await waitForGoal((goal) => goal?.status === "active");

    await updateGoal("pause");
    const paused = await waitForGoal((goal) => goal?.status === "paused");

    await updateGoal("resume");
    const resumed = await waitForGoal((goal) => goal?.status === "active");
    const terminal = await waitForGoal(
      (goal) =>
        goal === null ||
        (goal.status === "paused" &&
          typeof goal.terminalReason === "string" &&
          goal.terminalReason.includes("provider")),
      20_000,
    );

    await sleep(300);
    return { cursor, initial, created, paused, resumed, terminal };
  } finally {
    ws.close();
  }
}

async function runPrepareRestart() {
  const snapshot = await request("GET", `/sessions/${sessionId}/snapshot`);
  const cursor = {
    seq: snapshot.data.as_of_seq,
    epoch: snapshot.data.epoch,
  };
  const ws = await connectEvents(cursor);

  try {
    const initial = await getGoal();
    if (initial.data !== null) {
      await updateGoal("cancel");
      await waitForGoal((goal) => goal === null);
    }
    await request("POST", `/sessions/${sessionId}/profile`, {
      agent_config: {
        goal_objective:
          "KAP_RESTART_PROBE: remain paused until the user explicitly resumes; do not perform work.",
      },
    });
    const created = await waitForGoal((goal) => goal?.status === "active");
    await updateGoal("pause");
    const paused = await waitForGoal((goal) => goal?.status === "paused");
    await sleep(300);
    return { cursor, initial, created, paused };
  } finally {
    ws.close();
  }
}

async function runRestartCheck() {
  const snapshot = await request("GET", `/sessions/${sessionId}/snapshot`);
  const cursor = {
    seq: snapshot.data.as_of_seq,
    epoch: snapshot.data.epoch,
  };
  const ws = await connectEvents(cursor);

  try {
    const restored = await getGoal();
    await updateGoal("cancel");
    const cleared = await waitForGoal((goal) => goal === null);
    return { cursor, restored, cleared };
  } finally {
    ws.close();
  }
}

async function runInteractions() {
  const snapshot = await request("GET", `/sessions/${sessionId}/snapshot`);
  const cursor = {
    seq: snapshot.data.as_of_seq,
    epoch: snapshot.data.epoch,
  };
  const events = await connectEvents(cursor);

  try {
    const approvalPrompt = await request("POST", `/sessions/${sessionId}/prompts`, {
      content: [
        {
          type: "text",
          text: "Run the shell command `pwd` once. Do not use any other tool.",
        },
      ],
      permission_mode: "manual",
    });
    const approvalPendingEvent = await events.waitFor(
      (frame) =>
        frame.type === "event.session.work_changed" &&
        frame.payload.pending_interaction === "approval",
      30_000,
    );
    const approvalRequested = await waitForPendingInteraction("approvals");
    const approvalId = approvalRequested.approval_id;
    const approvalResolvedResponse = await request(
      "POST",
      `/sessions/${sessionId}/approvals/${approvalId}`,
      { decision: "rejected", feedback: "Protocol probe: deny execution." },
    );
    const approvalIdle = await waitForSessionIdle();

    const questionPrompt = await request("POST", `/sessions/${sessionId}/prompts`, {
      content: [
        {
          type: "text",
          text: "Use AskUserQuestion to ask exactly: Choose probe result. Offer two options: Pass and Fail. Do not use any other tool.",
        },
      ],
      permission_mode: "manual",
    });
    const questionPendingEvent = await events.waitFor(
      (frame) =>
        frame.type === "event.session.work_changed" &&
        frame.payload.pending_interaction === "question",
      30_000,
    );
    const questionRequested = await waitForPendingInteraction("questions");
    const questionId = questionRequested.question_id;
    const question = questionRequested.questions[0];
    const option = question.options[0];
    const questionAnsweredResponse = await request(
      "POST",
      `/sessions/${sessionId}/questions/${questionId}`,
      {
        answers: {
          [question.id]: { kind: "single", option_id: option.id },
        },
      },
    );
    const questionIdle = await waitForSessionIdle();

    return {
      cursor,
      approvalPrompt,
      approvalPendingEvent,
      approvalRequested,
      approvalResolvedResponse,
      approvalIdle,
      questionPrompt,
      questionPendingEvent,
      questionRequested,
      questionAnsweredResponse,
      questionIdle,
    };
  } finally {
    events.close();
  }
}

async function waitForPendingInteraction(resource, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await request(
      "GET",
      `/sessions/${sessionId}/${resource}?status=pending`,
    );
    if (response.data.items.length > 0) return response.data.items[0];
    await sleep(200);
  }
  throw new Error(`Timed out waiting for pending ${resource} interaction after ${timeoutMs}ms`);
}

async function updateGoal(goalControl) {
  return request("POST", `/sessions/${sessionId}/profile`, {
    agent_config: { goal_control: goalControl },
  });
}

async function getGoal() {
  return request("GET", `/sessions/${sessionId}/goal`);
}

async function waitForGoal(predicate, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await getGoal();
    if (predicate(response.data)) return response;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for Goal state after ${timeoutMs}ms`);
}

async function waitForSessionIdle(timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await request("GET", `/sessions/${sessionId}/status`);
    if (response.data.busy === false) return response;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for Session idle after ${timeoutMs}ms`);
}

async function connectEvents(cursor) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/ws`;
  const protocols = token ? [`kimi-code.bearer.${token}`] : undefined;
  const ws = new WebSocket(url, protocols);
  const frames = [];
  const waiters = new Set();

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for KAP WebSocket")), 5_000);
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("KAP WebSocket connection failed"));
    };
    ws.onmessage = async (event) => {
      const frame = JSON.parse(String(event.data));
      frames.push(frame);
      for (const waiter of waiters) {
        if (!waiter.predicate(frame)) continue;
        waiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.resolve(frame);
      }
      await record("ws_frame", frame);
      if (frame.type === "server_hello") {
        ws.send(
          JSON.stringify({
            type: "client_hello",
            id: "probe-hello",
            payload: {
              client_id: "carrent-goal-probe",
              subscriptions: [sessionId],
              cursors: { [sessionId]: cursor },
            },
          }),
        );
        clearTimeout(timeout);
        setTimeout(resolve, 200);
      } else if (frame.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", payload: { nonce: frame.payload?.nonce } }));
      }
    };
  });

  return {
    close: () => ws.close(),
    waitFor(predicate, timeoutMs = 5_000) {
      const existing = frames.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timeout: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`Timed out waiting for KAP WebSocket frame after ${timeoutMs}ms`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

async function request(method, pathname, body) {
  const url = `${baseUrl}${pathname}`;
  const headers = {
    "X-Kimi-Client-Id": "carrent-goal-probe",
    "X-Kimi-Client-Name": "Carrent Goal Probe",
    "X-Kimi-Client-Version": "0",
    "X-Kimi-Client-Ui-Mode": "headless",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  await record("http", {
    method,
    pathname,
    status: response.status,
    payload,
  });
  if (!response.ok || payload.code !== 0) {
    throw new Error(`${method} ${pathname} failed: ${response.status} ${payload.msg || ""}`.trim());
  }
  return payload;
}

async function record(type, payload) {
  const row = {
    seq: seq++,
    time: new Date().toISOString(),
    type,
    payload,
  };
  writeQueue = writeQueue.then(() => appendFile(transcriptPath, `${JSON.stringify(row)}\n`));
  await writeQueue;
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const [key, rawValue] = arg.slice(2).split("=", 2);
    parsed[key] = rawValue == null ? true : rawValue;
  }
  return parsed;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
