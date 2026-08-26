import { randomUUID } from "node:crypto";
import os from "node:os";

import type { SkillRecord } from "../../src/shared/skills";
import {
  errorMessage,
  readObject,
  readString,
  startMcpHttpServer,
  toolError,
  toolResult,
  type JsonObject,
} from "./mcpHttpServer";
import {
  listInstalledSkills,
  listSkillResources,
  readSkill,
  readSkillResource,
  SkillCatalogError,
  type SkillLocator,
  type SkillReadResult,
  type SkillResourceReadResult,
} from "../skills/skillCatalog";

export type CarrentBridgeMcpServerDescriptor = {
  id: string;
  name: string;
  type: "http";
  url: string;
  headers: Array<{ name: string; value: string }>;
};

/**
 * Audit entries cover only requests the Bridge itself handled. Provider-owned
 * reads (e.g. Kimi's native `Skill` tool) never appear here and must not be
 * inferred from this log. Entries never carry tokens, skill bodies, or other
 * sensitive content.
 */
export type CarrentBridgeAuditEntry = {
  at: string;
  runId?: string;
  /** Runtime that owns the Bridge session, when the call chain provides it. */
  runtimeId?: string;
  toolName: string;
  outcome: "allow" | "deny" | "error";
  /** Catalog/validation code for deny, "tool_error" for unexpected failures. */
  errorCode?: string;
  skillName?: string;
  skillPath?: string;
  resourcePath?: string;
};

export type CarrentBridgeHandle = {
  mcpServer: CarrentBridgeMcpServerDescriptor;
  close: () => Promise<void>;
};

export type CarrentBridgeFactory = (options: {
  runId: string;
  cwd: string;
}) => Promise<CarrentBridgeHandle | null>;

export type SkillCatalogBridgeService = {
  listSkills: () => Promise<SkillRecord[]>;
  readSkill: (locator: SkillLocator) => Promise<SkillReadResult>;
  listSkillResources: (
    locator: SkillLocator,
  ) => Promise<Awaited<ReturnType<typeof listSkillResources>>>;
  readSkillResource: (
    locator: SkillLocator,
    resourcePath: string,
  ) => Promise<SkillResourceReadResult>;
};

const DEFAULT_AUDIT_LIMIT = 1_000;
const defaultAuditEntries: CarrentBridgeAuditEntry[] = [];

export function getCarrentBridgeAuditEntries() {
  return [...defaultAuditEntries];
}

export function clearCarrentBridgeAuditEntries() {
  defaultAuditEntries.length = 0;
}

export async function startCarrentBridge(
  options: {
    runId?: string;
    runtimeId?: string;
    homeDir?: string;
    projectDir?: string;
    token?: string;
    catalog?: SkillCatalogBridgeService;
    audit?: (entry: CarrentBridgeAuditEntry) => void;
    now?: () => Date;
  } = {},
): Promise<CarrentBridgeHandle> {
  const token = options.token ?? randomUUID();
  const bridge = new CarrentBridgeServer({
    runId: options.runId,
    runtimeId: options.runtimeId,
    token,
    catalog:
      options.catalog ?? createDefaultSkillCatalogService(options.homeDir, options.projectDir),
    audit: options.audit ?? recordDefaultAuditEntry,
    now: options.now ?? (() => new Date()),
  });
  return bridge.start();
}

function recordDefaultAuditEntry(entry: CarrentBridgeAuditEntry) {
  defaultAuditEntries.push(entry);
  if (defaultAuditEntries.length > DEFAULT_AUDIT_LIMIT) {
    defaultAuditEntries.splice(0, defaultAuditEntries.length - DEFAULT_AUDIT_LIMIT);
  }
}

function createDefaultSkillCatalogService(
  homeDir = os.homedir(),
  projectDir?: string,
): SkillCatalogBridgeService {
  return {
    listSkills: () => listInstalledSkills({ homeDir, projectDir }),
    readSkill: (locator) => readSkill(locator, { homeDir, projectDir }),
    listSkillResources: (locator) => listSkillResources(locator, { homeDir, projectDir }),
    readSkillResource: (locator, resourcePath) =>
      readSkillResource(locator, resourcePath, { homeDir, projectDir }),
  };
}

class CarrentBridgeServer {
  constructor(
    private readonly options: {
      runId?: string;
      runtimeId?: string;
      token: string;
      catalog: SkillCatalogBridgeService;
      audit?: (entry: CarrentBridgeAuditEntry) => void;
      now: () => Date;
    },
  ) {}

  async start(): Promise<CarrentBridgeHandle> {
    const server = await startMcpHttpServer({
      serverName: "carrent_bridge",
      token: this.options.token,
      tools: TOOL_DEFINITIONS,
      handleToolCall: (params) => this.handleToolCall(params),
      unsupportedMethodMessage: (method) => `Unsupported Carrent Bridge method: ${method}`,
      noPortErrorMessage: "Carrent Bridge did not receive a local port.",
    });

    return {
      mcpServer: {
        id: "carrent_bridge",
        name: "carrent_bridge",
        type: "http",
        url: server.url,
        headers: [{ name: "Authorization", value: `Bearer ${this.options.token}` }],
      },
      close: () => server.close(),
    };
  }

  private async handleToolCall(params: unknown) {
    const payload = readObject(params);
    const name = readString(payload?.name);
    const args = readObject(payload?.arguments) ?? {};
    const toolName = name ?? "unknown";

    try {
      if (name === "list_skills") {
        const skills = await this.options.catalog.listSkills();
        this.audit({ toolName: name, outcome: "allow" });
        return toolResult({
          skills: skills.map(formatSkillMetadata),
        });
      }

      if (name === "read_skill") {
        const result = await this.options.catalog.readSkill(readSkillLocator(args));
        this.audit({
          toolName: name,
          outcome: "allow",
          skillName: result.skill.name,
          skillPath: result.skill.declaredPath ?? result.skill.path,
        });
        return toolResult(formatSkillRead(result));
      }

      if (name === "list_skill_resources") {
        const result = await this.options.catalog.listSkillResources(readSkillLocator(args));
        this.audit({
          toolName: name,
          outcome: "allow",
          skillName: result.skill.name,
          skillPath: result.skill.declaredPath ?? result.skill.path,
        });
        return toolResult({
          skill: formatSkillMetadata(result.skill),
          resources: result.resources,
        });
      }

      if (name === "read_skill_resource") {
        const resourcePath = readString(args.resourcePath) ?? readString(args.path);
        if (!resourcePath) {
          throw new SkillCatalogError("resource_not_found", "Skill resource path is required.");
        }

        const result = await this.options.catalog.readSkillResource(
          readResourceSkillLocator(args),
          resourcePath,
        );
        this.audit({
          toolName: name,
          outcome: "allow",
          skillName: result.skill.name,
          skillPath: result.skill.declaredPath ?? result.skill.path,
          resourcePath: result.resource.path,
        });
        return toolResult(formatSkillResourceRead(result));
      }

      this.audit({ toolName, outcome: "deny", errorCode: "unknown_tool" });
      return toolError("unknown_tool", `Unknown Carrent Bridge tool: ${toolName}`);
    } catch (error) {
      // Expected catalog/validation failures are denials; anything else is an
      // unexpected Bridge error. Neither records request payloads or content.
      if (error instanceof SkillCatalogError) {
        this.audit({ toolName, outcome: "deny", errorCode: error.code });
        return toolError(error.code, errorMessage(error));
      }

      this.audit({ toolName, outcome: "error", errorCode: "tool_error" });
      return toolError("tool_error", errorMessage(error));
    }
  }

  private audit(entry: Omit<CarrentBridgeAuditEntry, "at" | "runId" | "runtimeId">) {
    this.options.audit?.({
      at: this.options.now().toISOString(),
      runId: this.options.runId,
      runtimeId: this.options.runtimeId,
      ...entry,
    });
  }
}

const TOOL_DEFINITIONS = [
  {
    name: "list_skills",
    description: "List Carrent-installed skills available to this run.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "read_skill",
    description: "Read a Carrent-installed skill's SKILL.md content.",
    inputSchema: skillLocatorSchema(),
  },
  {
    name: "list_skill_resources",
    description: "List readable text resources under a Carrent-installed skill root.",
    inputSchema: skillLocatorSchema(),
  },
  {
    name: "read_skill_resource",
    description: "Read a text resource under a Carrent-installed skill root.",
    inputSchema: {
      type: "object",
      properties: {
        ...skillLocatorSchema().properties,
        skillPath: { type: "string" },
        resourcePath: { type: "string" },
        path: { type: "string" },
      },
      additionalProperties: false,
    },
  },
];

function skillLocatorSchema() {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      path: { type: "string" },
    },
    additionalProperties: false,
  };
}

function readSkillLocator(args: JsonObject): SkillLocator {
  return {
    name: readString(args.name) ?? undefined,
    path: readString(args.skillPath) ?? readString(args.path) ?? undefined,
  };
}

function readResourceSkillLocator(args: JsonObject): SkillLocator {
  return {
    name: readString(args.name) ?? undefined,
    path: readString(args.skillPath) ?? undefined,
  };
}

function formatSkillMetadata(skill: SkillRecord) {
  return {
    name: skill.name,
    description: skill.description,
    source: skill.source,
    scope: skill.scope,
    path: skill.path,
    declaredPath: skill.declaredPath ?? skill.path,
    realPath: skill.realPath ?? skill.path,
    declaredRootPath: skill.declaredRootPath,
    realRootPath: skill.realRootPath,
  };
}

function formatSkillRead(result: SkillReadResult) {
  return {
    skill: formatSkillMetadata(result.skill),
    content: result.content,
  };
}

function formatSkillResourceRead(result: SkillResourceReadResult) {
  return {
    skill: formatSkillMetadata(result.skill),
    resource: result.resource,
    content: result.content,
  };
}
