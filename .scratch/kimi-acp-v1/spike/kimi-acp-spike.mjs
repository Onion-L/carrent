#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const defaultCwd = process.env.KIMI_ACP_CWD || repoRoot;
const kimiBin = process.env.KIMI_BIN || "kimi";
const outputDir = path.join(repoRoot, ".scratch/kimi-acp-v1/spike/output");

const args = parseArgs(process.argv.slice(2));
const scenario = args._[0] || "handshake";
const workspaceCwd = path.resolve(args.cwd || defaultCwd);
const transcriptPath = path.join(outputDir, `${scenario}.jsonl`);

class AcpProcess {
  constructor({ cwd, transcriptPath }) {
    this.cwd = cwd;
    this.transcriptPath = transcriptPath;
    this.nextId = 1;
    this.nextSeq = 1;
    this.pending = new Map();
    this.notifications = [];
    this.clientRequests = [];
    this.lineQueue = Promise.resolve();
    this.recordQueue = Promise.resolve();
    this.child = spawn(kimiBin, ["acp"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.exitPromise = new Promise((resolve) => {
      this.child.on("exit", (code, signal) => {
        void this.record("exit", { code, signal });
        resolve({ code, signal });
      });
    });
    this.child.on("error", (error) => {
      void this.record("process_error", { message: error.message });
    });
    this.child.stderr.on("data", (chunk) => {
      void this.record("stderr", chunk.toString());
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      this.lineQueue = this.lineQueue
        .then(() => this.handleLine(line))
        .catch((error) => this.record("line_handler_error", errorMessage(error)));
    });
  }

  async initialize() {
    return this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: false },
        terminal: false,
      },
    });
  }

  async newSession() {
    return this.request("session/new", {
      cwd: this.cwd,
      mcpServers: [],
    });
  }

  async prompt(sessionId, text) {
    return this.request(
      "session/prompt",
      {
        sessionId,
        prompt: [{ type: "text", text }],
      },
      { timeoutMs: 180000 },
    );
  }

  async loadSession(sessionId) {
    return this.request("session/load", {
      sessionId,
      cwd: this.cwd,
      mcpServers: [],
    });
  }

  async resumeSession(sessionId) {
    return this.request("session/resume", {
      sessionId,
      cwd: this.cwd,
      mcpServers: [],
    });
  }

  async listSessions() {
    return this.request("session/list", {
      cwd: this.cwd,
      cursor: null,
    });
  }

  async setConfigOption(sessionId, configId, value) {
    return this.request("session/set_config_option", {
      sessionId,
      configId,
      value,
    });
  }

  async cancel(sessionId) {
    await this.notify("session/cancel", { sessionId });
  }

  async request(method, params, options = {}) {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    await this.record("client_request", message);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);

    const timeoutMs = options.timeoutMs || 30000;
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

  async notify(method, params) {
    const message = { jsonrpc: "2.0", method, params };
    await this.record("client_notification", message);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async handleLine(line) {
    if (!line.trim()) return;

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      await this.record("agent_parse_error", {
        line,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    await this.record("agent_message", message);

    if (message.id != null && message.method) {
      await this.handleAgentRequest(message);
      return;
    }

    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.notifications.push(message);
    }
  }

  async handleAgentRequest(message) {
    this.clientRequests.push(message);
    try {
      const result = await this.handleClientMethod(message.method, message.params || {});
      await this.respond(message.id, result ?? {});
    } catch (error) {
      await this.respondError(message.id, {
        code: error?.code || -32000,
        message: error instanceof Error ? error.message : String(error),
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
        throw rpcError(-32001, "writeTextFile is disabled for this spike");
      case "terminal/create":
        throw rpcError(-32002, "terminal capability is disabled for this spike");
      case "terminal/output":
      case "terminal/wait_for_exit":
      case "terminal/kill":
      case "terminal/release":
        throw rpcError(-32003, `terminal method ${method} is disabled for this spike`);
      default:
        throw rpcError(-32601, `Unsupported client method ${method}`);
    }
  }

  handlePermissionRequest(params) {
    const options = Array.isArray(params.options) ? params.options : [];
    const tool = params.toolCall || {};
    const title = `${tool.title || ""}`.toLowerCase();
    const kind = `${tool.kind || ""}`.toLowerCase();
    const forceDeny = args["deny-all"] === true || scenario === "permission";
    const readOnly =
      kind === "read" ||
      kind === "search" ||
      title.includes("read") ||
      title.includes("search") ||
      title.includes("list");
    const optionKind = forceDeny || !readOnly ? "reject_once" : "allow_once";
    const option =
      options.find((candidate) => candidate.kind === optionKind) ||
      options.find((candidate) => candidate.kind?.startsWith(optionKind.split("_")[0])) ||
      options[0];

    if (!option) {
      return { outcome: { outcome: "cancelled" } };
    }

    return {
      outcome: {
        outcome: "selected",
        optionId: option.optionId,
      },
    };
  }

  async handleReadTextFile(params) {
    const requestedPath = String(params.path || "");
    const resolved = path.resolve(this.cwd, requestedPath);
    const relative = path.relative(this.cwd, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw rpcError(-32004, `Refusing to read outside cwd: ${requestedPath}`);
    }
    return { content: await readFile(resolved, "utf8") };
  }

  async respond(id, result) {
    const message = { jsonrpc: "2.0", id, result };
    await this.record("client_response", message);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async respondError(id, error) {
    const message = { jsonrpc: "2.0", id, error };
    await this.record("client_error_response", message);
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

  async record(type, payload) {
    const entry = {
      seq: this.nextSeq++,
      time: new Date().toISOString(),
      type,
      payload,
    };
    this.recordQueue = this.recordQueue.then(() =>
      appendFile(this.transcriptPath, `${JSON.stringify(entry)}\n`),
    );
    await this.recordQueue;
  }
}

await mkdir(outputDir, { recursive: true });
await writeFile(transcriptPath, "");

const client = new AcpProcess({ cwd: workspaceCwd, transcriptPath });
const summary = {
  scenario,
  transcriptPath,
  cwd: workspaceCwd,
  kimiBin,
  initialize: null,
  session: null,
  result: null,
  error: null,
};

try {
  summary.initialize = await client.initialize();

  if (scenario === "list") {
    summary.result = await client.listSessions();
  } else if (scenario === "load") {
    assertArg(args.session, "load requires --session=<sessionId>");
    summary.result = await client.loadSession(args.session);
  } else if (scenario === "resume") {
    assertArg(args.session, "resume requires --session=<sessionId>");
    summary.result = await client.resumeSession(args.session);
  } else {
    summary.session = await client.newSession();
    const sessionId = summary.session.sessionId;

    if (scenario === "handshake") {
      summary.result = { ok: true };
    } else if (scenario === "set-config") {
      summary.result = await client.setConfigOption(
        sessionId,
        args.config || "mode",
        args.value || "plan",
      );
    } else if (scenario === "prompt") {
      summary.result = await client.prompt(
        sessionId,
        args.prompt ||
          "Inspect package.json in this project and answer only with the package name and workspace package manager. Do not edit files. Do not run shell commands.",
      );
    } else if (scenario === "permission") {
      summary.result = await client.prompt(
        sessionId,
        args.prompt ||
          "Please run `pwd` in this workspace. The ACP client will deny execution permission; after that, report the denial briefly.",
      );
    } else if (scenario === "cancel") {
      const cancelAfterMs = Number(args["cancel-after"] || 1000);
      const promptPromise = client.prompt(
        sessionId,
        args.prompt ||
          "Write a long, detailed explanation of this repository structure. Keep going until you are stopped.",
      );
      await sleep(cancelAfterMs);
      await client.cancel(sessionId);
      summary.result = await promptPromise;
    } else {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await client.stop();
  await client.record("summary", summary);
}

console.log(JSON.stringify(summary, null, 2));

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

function assertArg(value, message) {
  if (!value) throw new Error(message);
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
