#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const outputDir = path.join(repoRoot, ".scratch/agent-runtime-roadmap/spike/output");
const kimiBin = process.env.KIMI_BIN || "kimi";
const args = parseArgs(process.argv.slice(2));
const scenario = args._[0] || "commands";
const cwd = path.resolve(args.cwd || process.env.KIMI_ACP_CWD || repoRoot);
const transcriptPath = path.join(outputDir, `${scenario}.jsonl`);

class Recorder {
  seq = 1;
  queue = Promise.resolve();

  async reset() {
    await mkdir(outputDir, { recursive: true });
    await writeFile(transcriptPath, "");
  }

  async record(type, payload, processName) {
    const row = {
      seq: this.seq++,
      time: new Date().toISOString(),
      process: processName,
      type,
      payload,
    };
    this.queue = this.queue.then(() => appendFile(transcriptPath, `${JSON.stringify(row)}\n`));
    await this.queue;
  }
}

class AcpProcess {
  constructor({ name, recorder, permission = "reject", cancelAfterGoalCreate = false }) {
    this.name = name;
    this.recorder = recorder;
    this.permission = permission;
    this.cancelAfterGoalCreate = cancelAfterGoalCreate;
    this.nextId = 1;
    this.pending = new Map();
    this.toolNames = new Map();
    this.currentSessionId = null;
    this.cancelSent = false;
    this.lineQueue = Promise.resolve();
    this.child = spawn(kimiBin, ["acp"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.exitPromise = new Promise((resolve) => {
      this.child.on("exit", (code, signal) => {
        void this.recorder.record("exit", { code, signal }, this.name);
        resolve({ code, signal });
      });
    });
    this.child.on("error", (error) => {
      void this.recorder.record("process_error", { message: error.message }, this.name);
    });
    this.child.stderr.on("data", (chunk) => {
      void this.recorder.record("stderr", chunk.toString(), this.name);
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      this.lineQueue = this.lineQueue
        .then(() => this.handleLine(line))
        .catch((error) => this.recorder.record("line_handler_error", errorMessage(error), this.name));
    });
  }

  initialize() {
    return this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: false },
        terminal: false,
      },
    });
  }

  async newSession() {
    const result = await this.request("session/new", { cwd, mcpServers: [] });
    this.currentSessionId = result.sessionId;
    return result;
  }

  async resumeSession(sessionId) {
    const result = await this.request("session/resume", { sessionId, cwd, mcpServers: [] });
    this.currentSessionId = sessionId;
    return result;
  }

  async loadSession(sessionId) {
    const result = await this.request("session/load", { sessionId, cwd, mcpServers: [] });
    this.currentSessionId = sessionId;
    return result;
  }

  prompt(sessionId, text, timeoutMs = 180_000) {
    this.currentSessionId = sessionId;
    return this.request(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text }] },
      timeoutMs,
    );
  }

  setMode(sessionId, value) {
    return this.setConfigOption(sessionId, "mode", value);
  }

  setConfigOption(sessionId, configId, value) {
    return this.request("session/set_config_option", {
      sessionId,
      configId,
      value,
    });
  }

  listSessions() {
    return this.request("session/list", { cwd, cursor: null });
  }

  async cancel(sessionId) {
    await this.notify("session/cancel", { sessionId });
  }

  async request(method, params, timeoutMs = 30_000) {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    await this.recorder.record("client_request", message, this.name);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  async requestExpectError(method, params = {}) {
    try {
      return { method, unexpectedlySucceeded: await this.request(method, params) };
    } catch (error) {
      return { method, error: errorMessage(error) };
    }
  }

  async notify(method, params) {
    const message = { jsonrpc: "2.0", method, params };
    await this.recorder.record("client_notification", message, this.name);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      await this.recorder.record(
        "agent_parse_error",
        { line, message: errorMessage(error) },
        this.name,
      );
      return;
    }

    await this.recorder.record("agent_message", message, this.name);

    if (message.id != null && message.method) {
      await this.handleAgentRequest(message);
      return;
    }
    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "session/update") await this.handleSessionUpdate(message.params?.update);
  }

  async handleSessionUpdate(update) {
    if (!update || typeof update !== "object") return;
    if (update.sessionUpdate === "tool_call") {
      this.toolNames.set(update.toolCallId, String(update.title || ""));
      return;
    }
    if (
      this.cancelAfterGoalCreate &&
      !this.cancelSent &&
      update.sessionUpdate === "tool_call_update" &&
      update.status === "completed" &&
      /creategoal|create goal/i.test(this.toolNames.get(update.toolCallId) || "") &&
      this.currentSessionId
    ) {
      this.cancelSent = true;
      await this.recorder.record(
        "probe_action",
        { action: "cancel_after_goal_created", sessionId: this.currentSessionId },
        this.name,
      );
      await this.cancel(this.currentSessionId);
    }
  }

  async handleAgentRequest(message) {
    try {
      const result = await this.handleClientMethod(message.method, message.params || {});
      await this.respond(message.id, result ?? {});
    } catch (error) {
      await this.respondError(message.id, {
        code: error?.code || -32000,
        message: errorMessage(error),
      });
    }
  }

  async handleClientMethod(method, params) {
    switch (method) {
      case "session/request_permission":
        return this.handlePermissionRequest(params);
      case "fs/read_text_file":
        return this.handleReadTextFile(params);
      case "fs/write_text_file":
        throw rpcError(-32001, "writeTextFile is disabled for this probe");
      default:
        throw rpcError(-32601, `Unsupported client method ${method}`);
    }
  }

  handlePermissionRequest(params) {
    const options = Array.isArray(params.options) ? params.options : [];
    const title = String(params.toolCall?.title || "");
    const question = title === "AskUserQuestion";
    let option;

    if (question && this.permission === "answer-first") {
      option = options.find((candidate) => candidate.kind === "allow_once") || options[0];
    } else if (/creategoal|start a goal/i.test(title + JSON.stringify(params.toolCall || {}))) {
      if (this.permission === "manual") {
        option = options.find((candidate) => /manual/i.test(candidate.name || ""));
      } else if (this.permission === "auto") {
        option = options.find((candidate) => /auto/i.test(candidate.name || ""));
      }
    }

    if (!option && this.permission !== "reject") {
      option = options.find((candidate) => candidate.kind === "allow_once");
    }
    if (!option) {
      option =
        options.find((candidate) => candidate.kind === "reject_once") ||
        options.find((candidate) => /reject|do not start/i.test(candidate.name || ""));
    }
    return option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } };
  }

  async handleReadTextFile(params) {
    const requestedPath = String(params.path || "");
    const resolved = path.resolve(cwd, requestedPath);
    const relative = path.relative(cwd, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw rpcError(-32004, `Refusing to read outside cwd: ${requestedPath}`);
    }
    return { content: await readFile(resolved, "utf8") };
  }

  async respond(id, result) {
    const message = { jsonrpc: "2.0", id, result };
    await this.recorder.record("client_response", message, this.name);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async respondError(id, error) {
    const message = { jsonrpc: "2.0", id, error };
    await this.recorder.record("client_error_response", message, this.name);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async stop() {
    await this.lineQueue;
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    const hardKill = setTimeout(() => this.child.kill("SIGKILL"), 1500);
    hardKill.unref();
    await Promise.race([this.exitPromise, sleep(2500)]);
    clearTimeout(hardKill);
  }
}

const recorder = new Recorder();
await recorder.reset();
const summary = { scenario, cwd, kimiBin, transcriptPath, phases: [], error: null };

try {
  if (scenario === "commands") await runCommands();
  else if (scenario === "goal-denied") await runGoalDenied();
  else if (scenario === "goal-complete") await runGoalComplete();
  else if (scenario === "goal-restart") await runGoalRestart();
  else if (scenario === "existing-goal") await runExistingGoal();
  else throw new Error(`Unknown scenario: ${scenario}`);
} catch (error) {
  summary.error = errorMessage(error);
  process.exitCode = 1;
}

await recorder.record("summary", summary, "probe");
console.log(JSON.stringify(summary, null, 2));

async function runCommands() {
  const client = new AcpProcess({ name: "commands", recorder });
  try {
    const initialize = await client.initialize();
    const session = await client.newSession();
    const sessionId = session.sessionId;
    const help = await client.prompt(sessionId, "/help");
    const goalSlash = await client.prompt(sessionId, "/goal status");
    const methodFailures = [];
    for (const method of [
      "session/get_goal",
      "session/create_goal",
      "session/pause_goal",
      "session/resume_goal",
      "session/cancel_goal",
      "goal/get",
      "ext/goal",
    ]) {
      methodFailures.push(await client.requestExpectError(method, { sessionId }));
    }
    summary.phases.push({ initialize, session, help, goalSlash, methodFailures });
  } finally {
    await client.stop();
  }
}

async function runGoalDenied() {
  const client = new AcpProcess({ name: "goal-denied", recorder, permission: "reject" });
  try {
    const initialize = await client.initialize();
    const session = await client.newSession();
    const model = args.model
      ? await client.setConfigOption(session.sessionId, "model", args.model)
      : null;
    const result = await client.prompt(
      session.sessionId,
      "Create a durable Goal now. Objective: respond with GOAL_DENIED_PROBE. Done when that exact token is in the final answer. Do not access files or run shell commands.",
    );
    summary.phases.push({ initialize, session, model, result });
  } finally {
    await client.stop();
  }
}

async function runGoalComplete() {
  const client = new AcpProcess({ name: "goal-complete", recorder, permission: "auto" });
  try {
    const initialize = await client.initialize();
    const session = await client.newSession();
    const mode = await client.setMode(session.sessionId, "auto");
    const result = await client.prompt(
      session.sessionId,
      "Create a durable Goal now with objective: respond with GOAL_COMPLETE_PROBE. The completion criterion is: the final answer contains exactly GOAL_COMPLETE_PROBE. Do not access files or run shell commands. After satisfying the criterion, call UpdateGoal with complete.",
    );
    await sleep(Number(args["settle-ms"] || 5000));
    summary.phases.push({ initialize, session, mode, result });
  } finally {
    await client.stop();
  }
}

async function runGoalRestart() {
  let sessionId;
  const starter = new AcpProcess({
    name: "starter",
    recorder,
    permission: "manual",
    cancelAfterGoalCreate: true,
  });
  try {
    const initialize = await starter.initialize();
    const session = await starter.newSession();
    sessionId = session.sessionId;
    const result = await starter.prompt(
      sessionId,
      "Create a durable Goal now. Objective: complete three distinct goal turns, writing GOAL_RESTART_TURN_1, GOAL_RESTART_TURN_2, then GOAL_RESTART_TURN_3. Completion criterion: all three markers have been emitted. Do not access files or run shell commands. Do not mark it complete before the third distinct goal turn.",
    );
    summary.phases.push({ name: "starter", initialize, session, result });
  } finally {
    await starter.stop();
  }

  const resumed = new AcpProcess({ name: "resumed", recorder, permission: "reject" });
  try {
    const initialize = await resumed.initialize();
    const resume = await resumed.resumeSession(sessionId);
    const state = await resumed.prompt(
      sessionId,
      "Call GetGoal and report its JSON exactly. Do not resume, replace, cancel, or otherwise modify the Goal.",
    );
    summary.phases.push({ name: "resumed", initialize, resume, state });
  } finally {
    await resumed.stop();
  }

  const loaded = new AcpProcess({ name: "loaded", recorder, permission: "reject" });
  try {
    const initialize = await loaded.initialize();
    const load = await loaded.loadSession(sessionId);
    summary.phases.push({ name: "loaded", initialize, load });
  } finally {
    await loaded.stop();
  }
}

async function runExistingGoal() {
  if (!args.session) throw new Error("existing-goal requires --session=<sessionId>");
  const sessionId = args.session;

  const resumed = new AcpProcess({ name: "resumed-existing", recorder });
  try {
    const initialize = await resumed.initialize();
    const resume = await resumed.resumeSession(sessionId);
    const status = await resumed.prompt(sessionId, "/status");
    const goalStatus = await resumed.prompt(sessionId, "/goal status");
    const goalRpc = await resumed.requestExpectError("session/get_goal", { sessionId });
    summary.phases.push({ name: "resumed-existing", initialize, resume, status, goalStatus, goalRpc });
  } finally {
    await resumed.stop();
  }

  const loaded = new AcpProcess({ name: "loaded-existing", recorder });
  try {
    const initialize = await loaded.initialize();
    const load = await loaded.loadSession(sessionId);
    summary.phases.push({ name: "loaded-existing", initialize, load });
  } finally {
    await loaded.stop();
  }
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

function rpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
