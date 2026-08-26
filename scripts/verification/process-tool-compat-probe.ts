/**
 * Process-tool compatibility probe (plan 007, phase 2): reruns the Kimi ACP
 * process-tool matrix — built-in Glob, built-in Grep, Bash `rg --files`,
 * Bash `rg`, and an fs/read_text_file control — against a real `kimi acp`
 * process with the terminal capability implemented by the probe itself.
 *
 * Usage:
 *   bun scripts/verification/process-tool-compat-probe.ts [scenario ...] [--output report.json]
 *   KIMI_BIN=/path/to/kimi bun scripts/verification/process-tool-compat-probe.ts
 *
 * - No scenario args runs the full matrix.
 * - Set KIMI_BIN to probe a specific Kimi build; the report records the
 *   version from initialize's agentInfo. Run once per version to build the
 *   compatibility matrix behind needsKimiProcessToolCompatibility.
 * - The probe does NOT inject Carrent's runtime compatibility instruction, so
 *   the results reflect Kimi's native ACP behavior for the probed version.
 * - Glob/Grep acceptance or rejection is recorded, not asserted. The Bash and
 *   fs control scenarios assert task success as the channel baseline.
 * - Exit code is non-zero when a scenario errors or a baseline fails. When no
 *   Kimi CLI is available the report says `SKIPPED: kimi unavailable` and the
 *   exit code stays 0 — a skipped matrix is never reported as passed.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const KIMI_BIN = process.env.KIMI_BIN ?? "kimi";
const RUN_TIMEOUT_MS = 3 * 60_000;
const MARKER = "BLUE-FALCON-117";
const RUNTIME_REJECTION = "ACP runtime only supports interactive Bash tool processes";
const SPAWN_FAILURE = "posix_spawnp failed";

const SCENARIOS: Array<{
  name: string;
  description: string;
  prompt: string;
  /** Baseline scenarios must finish their task; matrix scenarios only record. */
  expectTaskSuccess?: boolean;
  /** Marker that proves the file contents actually reached the model. */
  marker?: string;
}> = [
  {
    name: "builtin-glob",
    description: "Built-in Glob under ACP (recorded, not asserted)",
    prompt:
      "使用内置 Glob 工具查找当前项目下所有 *.probe.md 文件。不要用 Bash 或任何终端命令，只用 Glob 工具。回复找到的文件路径列表。",
  },
  {
    name: "builtin-grep",
    description: "Built-in Grep under ACP (recorded, not asserted)",
    prompt: `使用内置 Grep 工具在项目文件中搜索 "${MARKER}"。不要用 Bash 或任何终端命令，只用 Grep 工具。回复包含该标记的文件路径。`,
  },
  {
    name: "bash-rg-files",
    description: "Bash `rg --files` through the terminal capability (baseline)",
    prompt: "使用 Bash 工具运行 `rg --files`，把它的完整输出原样回复给我。",
    expectTaskSuccess: true,
    marker: "alpha.probe.md",
  },
  {
    name: "bash-rg",
    description: "Bash `rg` through the terminal capability (baseline)",
    prompt: `使用 Bash 工具运行 \`rg ${MARKER}\`，原样回复匹配行里的内容。`,
    expectTaskSuccess: true,
    marker: MARKER,
  },
  {
    name: "fs-read-control",
    description: "Read via fs/read_text_file (baseline)",
    prompt: `读取项目里 notes/alpha.probe.md 的内容，原样复述其中的 verification code。`,
    expectTaskSuccess: true,
    marker: MARKER,
  },
];

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type ScenarioResult = {
  name: string;
  description: string;
  status: "ok" | "failed" | "error";
  kimiVersion: string | null;
  observedToolCalls: Array<{ title?: string; kind?: string; status?: string }>;
  hostRequestCounts: Record<string, number>;
  runtimeRejectionObserved: boolean;
  spawnFailureObserved: boolean;
  taskSucceeded: boolean | null;
  stopReason: string | null;
  finalText: string;
  error?: string;
};

async function probeKimiAvailability(): Promise<{ available: boolean; version: string | null }> {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(KIMI_BIN, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolvePromise({ available: false, version: null });
      return;
    }
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", () => resolvePromise({ available: false, version: null }));
    child.on("close", (code) => {
      const version = code === 0 ? out.trim().split(/\s+/u).at(-1) || null : null;
      resolvePromise({ available: code === 0, version });
    });
  });
}

function installFixtures(projectDir: string) {
  mkdirSync(join(projectDir, "notes"), { recursive: true });
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(
    join(projectDir, "notes", "alpha.probe.md"),
    `# Alpha\n\nInternal verification code: ${MARKER}\n`,
  );
  writeFileSync(join(projectDir, "notes", "beta.probe.md"), "# Beta\n\nNothing here.\n");
  writeFileSync(join(projectDir, "src", "gamma.ts"), `// ${MARKER} lives in alpha\n`);
}

async function runScenario(
  scenario: (typeof SCENARIOS)[number],
  kimiVersion: string | null,
): Promise<ScenarioResult> {
  const projectDir = mkdtempSync(join(tmpdir(), "carrent-tool-probe-"));
  installFixtures(projectDir);

  const toolCalls: ScenarioResult["observedToolCalls"] = [];
  const hostRequestCounts = new Map<string, number>();
  let finalText = "";
  let stderrTail = "";
  let resolvedKimiVersion = kimiVersion;
  let runtimeRejectionObserved = false;
  let spawnFailureObserved = false;

  // Minimal terminal capability over plain pipes: faithful for the ACP
  // contract (create/output/wait_for_exit/kill/release) without node-pty,
  // whose event delivery does not work under the Bun runtime.
  const terminals = new Map<
    string,
    {
      child: ChildProcess;
      output: string;
      exitStatus: { exitCode?: number; signal?: string } | null;
    }
  >();
  let nextTerminalId = 1;

  const buildResult = (
    status: ScenarioResult["status"],
    fields: { stopReason?: string | null; error?: string },
  ): ScenarioResult => {
    const taskSucceeded =
      scenario.expectTaskSuccess === undefined
        ? null
        : scenario.marker !== undefined && finalText.includes(scenario.marker);
    const expectationFailed =
      status === "ok" && scenario.expectTaskSuccess === true && taskSucceeded !== true;
    return {
      name: scenario.name,
      description: scenario.description,
      status: expectationFailed ? "failed" : status,
      kimiVersion: resolvedKimiVersion,
      observedToolCalls: toolCalls,
      hostRequestCounts: Object.fromEntries(hostRequestCounts),
      runtimeRejectionObserved,
      spawnFailureObserved,
      taskSucceeded,
      stopReason: fields.stopReason ?? null,
      finalText,
      ...(fields.error ? { error: fields.error } : {}),
    };
  };

  try {
    return await new Promise<ScenarioResult>((resolvePromise) => {
      let settled = false;
      const finish = (
        status: ScenarioResult["status"],
        fields: Parameters<typeof buildResult>[1],
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill("SIGTERM");
        } catch {
          // Already exited.
        }
        resolvePromise(buildResult(status, fields));
      };

      const timer = setTimeout(() => {
        finish("error", { error: `timed out after ${RUN_TIMEOUT_MS}ms; stderr: ${stderrTail}` });
      }, RUN_TIMEOUT_MS);

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(KIMI_BIN, ["acp"], {
          cwd: projectDir,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: { ...process.env, NO_COLOR: "1" },
        });
      } catch (error) {
        finish("error", { error: `spawn failed: ${errorMessage(error)}` });
        return;
      }
      child.on("error", (error) => finish("error", { error: `spawn error: ${error.message}` }));
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      });
      child.on("exit", (code, signal) => {
        if (!settled) {
          finish("error", {
            error: `kimi exited early (code ${code}, signal ${signal}); stderr: ${stderrTail}`,
          });
        }
      });

      let nextId = 1;
      const pending = new Map<
        number,
        { resolve: (v: unknown) => void; reject: (e: Error) => void }
      >();
      let stdoutBuffer = "";

      const send = (method: string, params: unknown): Promise<unknown> => {
        const id = nextId++;
        return new Promise((resolveInner, rejectInner) => {
          pending.set(id, { resolve: resolveInner, reject: rejectInner });
          child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        });
      };
      const respond = (id: JsonRpcMessage["id"], result: unknown) => {
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
      };
      const respondError = (id: JsonRpcMessage["id"], error: { code: number; message: string }) => {
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`);
      };

      const noteHostRequest = (method: string) => {
        hostRequestCounts.set(method, (hostRequestCounts.get(method) ?? 0) + 1);
      };

      const handleTerminalCreate = (id: JsonRpcMessage["id"], params: Record<string, unknown>) => {
        const command = typeof params.command === "string" ? params.command : "";
        if (!command) {
          respondError(id, { code: -32000, message: "terminal/create command is required" });
          return;
        }
        const args = Array.isArray(params.args) ? (params.args as string[]) : null;
        const cwd = typeof params.cwd === "string" ? params.cwd : projectDir;
        const env: NodeJS.ProcessEnv = { ...process.env };
        if (Array.isArray(params.env)) {
          for (const variable of params.env as Array<{ name?: unknown; value?: unknown }>) {
            if (typeof variable?.name === "string" && typeof variable?.value === "string") {
              env[variable.name] = variable.value;
            }
          }
        }
        const file = args
          ? command
          : env.SHELL && env.SHELL.startsWith("/")
            ? env.SHELL
            : "/bin/sh";
        const finalArgs = args ?? ["-lc", command];
        const terminalId = `probe-terminal-${nextTerminalId++}`;
        try {
          const termChild = spawn(file, finalArgs, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
          const record = { child: termChild, output: "", exitStatus: null };
          terminals.set(terminalId, record);
          termChild.stdout?.on("data", (chunk: Buffer) => {
            record.output += chunk.toString();
          });
          termChild.stderr?.on("data", (chunk: Buffer) => {
            record.output += chunk.toString();
          });
          termChild.on("exit", (code, signal) => {
            record.exitStatus = signal ? { signal } : { exitCode: code ?? 0 };
          });
          respond(id, { terminalId });
        } catch (error) {
          respondError(id, { code: -32000, message: errorMessage(error) });
        }
      };

      const handleAgentRequest = (message: JsonRpcMessage) => {
        const params = (message.params ?? {}) as Record<string, unknown>;
        noteHostRequest(message.method ?? "unknown");
        switch (message.method) {
          case "fs/read_text_file": {
            const requested = typeof params.path === "string" ? params.path : "";
            const resolvedPath = resolve(requested);
            if (!resolvedPath.startsWith(projectDir + sep)) {
              respondError(message.id, {
                code: -32000,
                message: `path outside probe fixtures: ${requested}`,
              });
              return;
            }
            try {
              let content = readFileSync(resolvedPath, "utf8");
              if (typeof params.line === "number" || typeof params.limit === "number") {
                const lines = content.split("\n");
                const start = typeof params.line === "number" ? Math.max(0, params.line - 1) : 0;
                const limit =
                  typeof params.limit === "number" ? params.limit : lines.length - start;
                content = lines.slice(start, start + limit).join("\n");
              }
              respond(message.id, { content });
            } catch (error) {
              respondError(message.id, { code: -32000, message: errorMessage(error) });
            }
            return;
          }
          case "terminal/create":
            handleTerminalCreate(message.id, params);
            return;
          case "terminal/output":
          case "terminal/wait_for_exit":
          case "terminal/kill":
          case "terminal/release": {
            const terminalId = typeof params.terminalId === "string" ? params.terminalId : "";
            const terminal = terminals.get(terminalId);
            if (!terminal) {
              respondError(message.id, { code: -32000, message: "unknown terminal" });
              return;
            }
            if (message.method === "terminal/output") {
              respond(message.id, {
                output: terminal.output,
                truncated: false,
                ...(terminal.exitStatus ? { exitStatus: terminal.exitStatus } : {}),
              });
            } else if (message.method === "terminal/wait_for_exit") {
              if (terminal.exitStatus) {
                respond(message.id, terminal.exitStatus);
              } else {
                terminal.child.on("exit", () => respond(message.id, terminal.exitStatus ?? {}));
              }
            } else {
              if (!terminal.exitStatus) terminal.child.kill("SIGTERM");
              if (message.method === "terminal/release") terminals.delete(terminalId);
              respond(message.id, {});
            }
            return;
          }
          case "session/request_permission": {
            const options = Array.isArray(params.options) ? params.options : [];
            const preferred =
              options.find((o) => (o as { kind?: string }).kind === "allow_once") ??
              options.find((o) => (o as { kind?: string }).kind === "allow_always") ??
              options[0];
            if (preferred && typeof (preferred as { optionId?: string }).optionId === "string") {
              respond(message.id, {
                outcome: {
                  outcome: "selected",
                  optionId: (preferred as { optionId: string }).optionId,
                },
              });
            } else {
              respond(message.id, { outcome: { outcome: "cancelled" } });
            }
            return;
          }
          default:
            respondError(message.id, {
              code: -32601,
              message: `probe does not implement ${message.method}`,
            });
        }
      };

      const handleMessage = async (message: JsonRpcMessage) => {
        // A response carries `result`/`error` and no `method`; kimi's own
        // host-bound requests reuse the same numeric id space, so an id match
        // alone is not enough to treat a message as a response.
        if (
          message.id != null &&
          message.method === undefined &&
          pending.has(message.id as number)
        ) {
          const handler = pending.get(message.id as number)!;
          pending.delete(message.id as number);
          if (message.error) {
            handler.reject(new Error(JSON.stringify(message.error)));
          } else {
            handler.resolve(message.result);
          }
          return;
        }

        if (typeof message.method !== "string") return;

        if (message.id != null && message.method !== "session/update") {
          handleAgentRequest(message);
          return;
        }

        if (message.method === "session/update") {
          const serialized = JSON.stringify(message.params ?? {});
          if (serialized.includes(RUNTIME_REJECTION)) runtimeRejectionObserved = true;
          if (serialized.includes(SPAWN_FAILURE)) spawnFailureObserved = true;
          const params = message.params as {
            update?: { sessionUpdate?: string; [k: string]: unknown };
          };
          const update = params?.update ?? {};
          const kind = String(update.sessionUpdate ?? "unknown");
          if (kind === "tool_call" || kind === "tool_call_update") {
            toolCalls.push({
              title: typeof update.title === "string" ? update.title : undefined,
              kind: typeof update.kind === "string" ? update.kind : undefined,
              status: typeof update.status === "string" ? update.status : undefined,
            });
          }
          if (
            kind === "agent_message_chunk" &&
            typeof update.content === "object" &&
            update.content
          ) {
            const text = (update.content as { text?: unknown }).text;
            if (typeof text === "string") finalText += text;
          }
        }
      };

      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split(/\r?\n/u);
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let message: JsonRpcMessage;
          try {
            message = JSON.parse(line) as JsonRpcMessage;
          } catch {
            continue;
          }
          void handleMessage(message);
        }
      });

      void (async () => {
        const initializeResult = (await send("initialize", {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: false },
            terminal: true,
          },
        })) as { agentInfo?: { name?: string; version?: string } };
        if (typeof initializeResult?.agentInfo?.version === "string") {
          resolvedKimiVersion = initializeResult.agentInfo.version;
        }

        const newSession = (await send("session/new", { cwd: projectDir, mcpServers: [] })) as {
          sessionId?: string;
        };

        const promptResult = (await send("session/prompt", {
          sessionId: newSession.sessionId,
          prompt: [{ type: "text", text: scenario.prompt }],
        })) as { stopReason?: string };

        finish("ok", { stopReason: promptResult?.stopReason ?? null });
      })().catch((error) => {
        finish("error", { error: `${errorMessage(error)}; stderr: ${stderrTail}` });
      });
    });
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : null;
const requested = args.filter(
  (arg, index) => arg !== "--output" && (outputIndex < 0 || index !== outputIndex + 1),
);
if (args.includes("--list")) {
  console.log(SCENARIOS.map((scenario) => scenario.name).join("\n"));
  process.exit(0);
}

const selected =
  requested.length > 0
    ? SCENARIOS.filter((scenario) => requested.includes(scenario.name))
    : SCENARIOS;
const unknown = requested.filter((name) => !SCENARIOS.some((scenario) => scenario.name === name));
if (unknown.length > 0) {
  console.error(`Unknown scenario(s): ${unknown.join(", ")}. Use --list to see valid names.`);
  process.exit(2);
}

const kimi = await probeKimiAvailability();
if (!kimi.available) {
  const skipped = {
    status: "skipped",
    reason: "SKIPPED: kimi unavailable",
    kimi: { available: false, version: null },
    scenarios: [] as ScenarioResult[],
  };
  console.log(JSON.stringify(skipped, null, 2));
  if (outputPath) writeFileSync(outputPath, JSON.stringify(skipped, null, 2));
  process.exit(0);
}

console.error(
  `Running ${selected.length} scenario(s) against ${KIMI_BIN} (version ${kimi.version ?? "unknown"})...`,
);
const results: ScenarioResult[] = [];
for (const scenario of selected) {
  console.error(`[scenario] ${scenario.name}`);
  const result = await runScenario(scenario, kimi.version);
  results.push(result);
  console.error(`[scenario] ${scenario.name} -> ${result.status}`);
}

const report = {
  status: results.every((result) => result.status === "ok") ? "ok" : "failed",
  kimi: {
    available: true,
    version: results.find((r) => r.kimiVersion)?.kimiVersion ?? kimi.version,
  },
  startedAt: new Date().toISOString(),
  scenarios: results,
};
const json = JSON.stringify(report, null, 2);
console.log(json);
if (outputPath) writeFileSync(outputPath, json);
process.exit(report.status === "ok" ? 0 : 1);
