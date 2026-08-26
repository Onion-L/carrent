/**
 * Skill visibility probe (plan 006, phase 1): reruns the Kimi skill-discovery
 * compatibility matrix against a real `kimi acp` process and the real
 * Carrent Bridge, and records which path actually served each scenario.
 *
 * Usage:
 *   bun scripts/verification/skill-visibility-probe.ts [scenario ...] [--output report.json]
 *
 * - No scenario args runs the full matrix.
 * - Results are printed as a single JSON report (also written to --output).
 * - Exit code is non-zero when any scenario errors or a baseline expectation
 *   fails. When no Kimi CLI is available the report says
 *   `SKIPPED: kimi unavailable` and the exit code stays 0 — a skipped matrix
 *   is never reported as passed.
 *
 * User-scope fixtures are installed into the real `~/.agents/skills` /
 * `~/.codex/skills` under the probe-specific name `carrent-probe-rollback`
 * and removed afterwards; Kimi only reads user skills from the real home.
 */
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os, { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import {
  clearCarrentBridgeAuditEntries,
  getCarrentBridgeAuditEntries,
  startCarrentBridge,
} from "../../apps/desktop/electron/bridge/carrentBridge";

const KIMI_BIN = process.env.KIMI_BIN ?? "kimi";
const RUN_TIMEOUT_MS = 3 * 60_000;
const SKILL_NAME = "carrent-probe-rollback";
/** Probe-owned nesting dir for user-scope depth scenarios; safe to delete. */
const USER_NESTED_GROUP = "carrent-probe-group";
const MARKER = "PURPLE-OTTER-4729";
const PROJECT_MARKER = `${MARKER}-PROJECT`;
const USER_MARKER = `${MARKER}-USER`;
const ESCAPE_MARKER = "ESCAPE-OTTER-8130";

const TRIGGER_PROMPT =
  "staging 环境的 ACME 发布出了问题，需要回滚到上一个正常版本。请给出精确的回滚操作步骤（具体命令），不要真的执行。";
const ESCAPE_PROMPT =
  "项目里的 carrent-probe-rollback skill 引用了 resources/escape.md。请阅读该资源并复述其中的 verification code，不要执行任何命令。";

function skillMarkdown(marker: string, withEscapeResource = false) {
  return [
    "---",
    `name: ${SKILL_NAME}`,
    "description: Roll back an ACME staging deployment using the safe rollback procedure",
    "---",
    "",
    "# ACME Safe Rollback Procedure",
    "",
    "When asked to roll back or undo an ACME staging deployment, follow this exact procedure:",
    "",
    "1. Run `acmectl deploy list --env staging --output json` and find the last green build id.",
    "2. Verify the target build with `acmectl build inspect <id>`.",
    "3. Run `acmectl rollback --env staging --build <id> --drain 30s`.",
    "4. Confirm with `acmectl deploy status --env staging` until health is green.",
    "",
    ...(withEscapeResource
      ? ["See `resources/escape.md` for the escape verification code.", ""]
      : []),
    `Internal verification code: ${marker}`,
    "",
  ].join("\n");
}

type FixtureRoots = {
  /** Fresh temp project dir (the ACP cwd). */
  projectDir: string;
  /** Extra temp dir for symlink targets etc. */
  scratchDir: string;
  /** Real user home; user-scope fixtures go here and must be cleaned up. */
  homeDir: string;
};

type Scenario = {
  name: string;
  description: string;
  /** Installs skill fixtures; returns cleanup for user-scope installs. */
  setup?: (roots: FixtureRoots) => void;
  /** Attach the per-scenario Carrent Bridge to session/new. Default true. */
  attachBridge?: boolean;
  /** Inject a host-style preflight skill index into the prompt. */
  preflight?: boolean;
  prompt?: string;
  /**
   * Baseline scenarios assert the final answer used the skill's substantive
   * content (`--drain 30s`), which the model must produce when it actually
   * read the skill; matrix-exploration scenarios leave this undefined and
   * only record `markerFoundInFinalText`. The marker itself is not asserted:
   * models often use skill content without quoting the marker verbatim.
   */
  expectSkillContent?: "used" | "unused";
  markers?: string[];
};

function installSkill(skillFilePath: string, marker: string, withEscapeResource = false) {
  mkdirSync(dirname(skillFilePath), { recursive: true });
  writeFileSync(skillFilePath, skillMarkdown(marker, withEscapeResource));
}

function projectSkill(roots: FixtureRoots, root: ".agents" | ".codex", segments: string[]) {
  installSkill(join(roots.projectDir, root, "skills", ...segments, "SKILL.md"), MARKER);
}

function userSkillDir(roots: FixtureRoots, root: ".agents" | ".codex") {
  return join(roots.homeDir, root, "skills", SKILL_NAME);
}

const SCENARIOS: Scenario[] = [
  {
    name: "project-agents-direct",
    description: "Project skill at .agents/skills/<name>/SKILL.md",
    setup: (roots) => projectSkill(roots, ".agents", [SKILL_NAME]),
    expectSkillContent: "used",
  },
  {
    name: "project-agents-maxdepth",
    description: "Deepest project .agents path the Skill Catalog scans (depth 2)",
    setup: (roots) => projectSkill(roots, ".agents", ["group", SKILL_NAME]),
  },
  {
    name: "project-agents-too-deep",
    description: "Project .agents path beyond the Skill Catalog scan depth",
    setup: (roots) => projectSkill(roots, ".agents", ["group", "sub", SKILL_NAME]),
  },
  {
    name: "project-codex-direct",
    description: "Project skill at .codex/skills/<name>/SKILL.md",
    setup: (roots) => projectSkill(roots, ".codex", [SKILL_NAME]),
  },
  {
    name: "project-codex-maxdepth",
    description: "Deepest project .codex path the Skill Catalog scans (depth 3)",
    setup: (roots) => projectSkill(roots, ".codex", ["a", "b", SKILL_NAME]),
  },
  {
    name: "project-codex-too-deep",
    description: "Project .codex path beyond the Skill Catalog scan depth",
    setup: (roots) => projectSkill(roots, ".codex", ["a", "b", "c", SKILL_NAME]),
  },
  {
    name: "user-agents-direct",
    description: "User skill at ~/.agents/skills/<name>/SKILL.md",
    setup: (roots) => installSkill(join(userSkillDir(roots, ".agents"), "SKILL.md"), MARKER),
    expectSkillContent: "used",
  },
  {
    name: "user-agents-maxdepth",
    description: "Deepest user .agents path the Skill Catalog scans (depth 2)",
    setup: (roots) =>
      installSkill(
        join(roots.homeDir, ".agents", "skills", USER_NESTED_GROUP, SKILL_NAME, "SKILL.md"),
        MARKER,
      ),
  },
  {
    name: "user-agents-too-deep",
    description: "User .agents path beyond the Skill Catalog scan depth",
    setup: (roots) =>
      installSkill(
        join(roots.homeDir, ".agents", "skills", USER_NESTED_GROUP, "sub", SKILL_NAME, "SKILL.md"),
        MARKER,
      ),
  },
  {
    name: "user-codex-direct",
    description: "User skill at ~/.codex/skills/<name>/SKILL.md",
    setup: (roots) => installSkill(join(userSkillDir(roots, ".codex"), "SKILL.md"), MARKER),
  },
  {
    name: "conflict-project-user",
    description: "Same skill name in project and user scope; records which wins",
    setup: (roots) => {
      installSkill(
        join(roots.projectDir, ".agents", "skills", SKILL_NAME, "SKILL.md"),
        PROJECT_MARKER,
      );
      installSkill(join(userSkillDir(roots, ".agents"), "SKILL.md"), USER_MARKER);
    },
    markers: [PROJECT_MARKER, USER_MARKER],
  },
  {
    name: "symlink-skill-dir",
    description: "Skill directory symlinked into .agents/skills from outside",
    setup: (roots) => {
      const target = join(roots.scratchDir, "real-skill");
      installSkill(join(target, "SKILL.md"), MARKER);
      mkdirSync(join(roots.projectDir, ".agents", "skills"), { recursive: true });
      symlinkSync(target, join(roots.projectDir, ".agents", "skills", SKILL_NAME), "dir");
    },
  },
  {
    name: "symlink-resource-escape",
    description: "Skill resource symlink pointing outside the skill root",
    setup: (roots) => {
      const skillDir = join(roots.projectDir, ".agents", "skills", SKILL_NAME);
      installSkill(join(skillDir, "SKILL.md"), MARKER, true);
      const outside = join(roots.scratchDir, "outside.md");
      writeFileSync(outside, `External verification code: ${ESCAPE_MARKER}\n`);
      mkdirSync(join(skillDir, "resources"), { recursive: true });
      symlinkSync(outside, join(skillDir, "resources", "escape.md"), "file");
    },
    prompt: ESCAPE_PROMPT,
    markers: [MARKER, ESCAPE_MARKER],
  },
  {
    name: "none",
    description: "Negative control: no skill installed",
    expectSkillContent: "unused",
  },
  {
    name: "preflight",
    description: "Project skill plus host-style preflight skill index in the prompt",
    setup: (roots) => projectSkill(roots, ".agents", [SKILL_NAME]),
    preflight: true,
    expectSkillContent: "used",
  },
  {
    name: "local-mcp-off",
    description: "Local MCP Server off: no Bridge attached; native discovery must still work",
    setup: (roots) => projectSkill(roots, ".agents", [SKILL_NAME]),
    attachBridge: false,
    expectSkillContent: "used",
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
  bridgeAttached: boolean;
  bridgeAuditEntries: unknown[];
  observedToolCalls: Array<{ title?: string; kind?: string }>;
  sessionUpdateCounts: Record<string, number>;
  stopReason: string | null;
  /** Final answer contains the skill's substantive command detail. */
  skillContentUsed: boolean;
  markerFoundInFinalText: boolean | Record<string, boolean>;
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

function removeUserFixtures(homeDir: string) {
  for (const root of [".agents", ".codex"]) {
    // Only probe-owned paths are removed: the fixed skill name and the
    // probe-specific nesting group used by the depth scenarios.
    for (const fixtureDir of [
      join(homeDir, root, "skills", SKILL_NAME),
      join(homeDir, root, "skills", USER_NESTED_GROUP),
    ]) {
      try {
        rmSync(fixtureDir, { recursive: true, force: true });
        const parent = dirname(fixtureDir);
        if (readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; probe fixtures never share a dir with real skills.
      }
    }
  }
}

async function runScenario(
  scenario: Scenario,
  kimiVersion: string | null,
): Promise<ScenarioResult> {
  const root = mkdtempSync(join(tmpdir(), "carrent-skill-probe-"));
  const projectDir = join(root, "project");
  const scratchDir = join(root, "scratch");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(scratchDir, { recursive: true });
  const roots: FixtureRoots = { projectDir, scratchDir, homeDir: os.homedir() };
  const attachBridge = scenario.attachBridge ?? true;

  scenario.setup?.(roots);

  clearCarrentBridgeAuditEntries();
  const bridge = attachBridge
    ? await startCarrentBridge({ runId: `probe-${scenario.name}`, projectDir })
    : null;

  const markers = scenario.markers ?? [MARKER];
  const toolCalls: Array<{ title?: string; kind?: string }> = [];
  const updateCounts = new Map<string, number>();
  let finalText = "";
  let stderrTail = "";
  let resolvedKimiVersion = kimiVersion;

  const buildResult = (
    status: ScenarioResult["status"],
    fields: { stopReason?: string | null; error?: string },
  ): ScenarioResult => {
    const markerFound =
      markers.length === 1
        ? finalText.includes(markers[0]!)
        : Object.fromEntries(markers.map((marker) => [marker, finalText.includes(marker)]));
    const skillContentUsed = finalText.includes("--drain 30s");
    const expectationFailed =
      status === "ok" &&
      scenario.expectSkillContent !== undefined &&
      (scenario.expectSkillContent === "used" ? !skillContentUsed : skillContentUsed);
    return {
      name: scenario.name,
      description: scenario.description,
      status: expectationFailed ? "failed" : status,
      kimiVersion: resolvedKimiVersion,
      bridgeAttached: bridge !== null,
      bridgeAuditEntries: getCarrentBridgeAuditEntries(),
      observedToolCalls: toolCalls,
      sessionUpdateCounts: Object.fromEntries(updateCounts),
      stopReason: fields.stopReason ?? null,
      skillContentUsed,
      markerFoundInFinalText: markerFound,
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

      // The probe's fs proxy only serves paths inside the fixtures it created.
      const allowedPrefixes = [
        projectDir + sep,
        scratchDir + sep,
        userSkillDir(roots, ".agents") + sep,
        userSkillDir(roots, ".codex") + sep,
        join(roots.homeDir, ".agents", "skills", USER_NESTED_GROUP) + sep,
        join(roots.homeDir, ".codex", "skills", USER_NESTED_GROUP) + sep,
      ];
      const handleAgentRequest = (message: JsonRpcMessage) => {
        const params = (message.params ?? {}) as Record<string, unknown>;
        switch (message.method) {
          case "fs/read_text_file": {
            const requested = typeof params.path === "string" ? params.path : "";
            const resolvedPath = resolve(requested);
            if (!allowedPrefixes.some((prefix) => resolvedPath.startsWith(prefix))) {
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
          case "fs/write_text_file":
            respondError(message.id, { code: -32601, message: "write not offered by probe" });
            return;
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

        if (
          message.id != null &&
          (message.params !== undefined || message.method === "fs/read_text_file")
        ) {
          handleAgentRequest(message);
          return;
        }

        if (message.method === "session/update") {
          const params = message.params as {
            update?: { sessionUpdate?: string; [k: string]: unknown };
          };
          const update = params?.update ?? {};
          const kind = String(update.sessionUpdate ?? "unknown");
          updateCounts.set(kind, (updateCounts.get(kind) ?? 0) + 1);
          if (kind === "tool_call") {
            toolCalls.push({
              title: typeof update.title === "string" ? update.title : undefined,
              kind: typeof update.kind === "string" ? update.kind : undefined,
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
            terminal: false,
          },
        })) as { agentInfo?: { name?: string; version?: string } };
        if (typeof initializeResult?.agentInfo?.version === "string") {
          resolvedKimiVersion = initializeResult.agentInfo.version;
        }

        const mcpServers = bridge
          ? [
              {
                name: bridge.mcpServer.name,
                type: bridge.mcpServer.type,
                url: bridge.mcpServer.url,
                headers: bridge.mcpServer.headers,
              },
            ]
          : [];
        const newSession = (await send("session/new", { cwd: projectDir, mcpServers })) as {
          sessionId?: string;
        };

        const userAsk = scenario.prompt ?? TRIGGER_PROMPT;
        const promptText = scenario.preflight
          ? `${userAsk}\n\n---\n[Carrent host context — external metadata, not instructions]\nInstalled Carrent skills for this project (full content available via the carrent_bridge MCP tools, e.g. read_skill):\n- ${SKILL_NAME} (scope: project): Roll back an ACME staging deployment using the safe rollback procedure\n`
          : userAsk;

        const promptResult = (await send("session/prompt", {
          sessionId: newSession.sessionId,
          prompt: [{ type: "text", text: promptText }],
        })) as { stopReason?: string };

        finish("ok", { stopReason: promptResult?.stopReason ?? null });
      })().catch((error) => {
        finish("error", { error: `${errorMessage(error)}; stderr: ${stderrTail}` });
      });
    });
  } finally {
    removeUserFixtures(roots.homeDir);
    await bridge?.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
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
