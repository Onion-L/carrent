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

export type CarrentBridgeAuditEntry = {
  at: string;
  runId?: string;
  toolName: string;
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
    homeDir?: string;
    token?: string;
    catalog?: SkillCatalogBridgeService;
    audit?: (entry: CarrentBridgeAuditEntry) => void;
    now?: () => Date;
  } = {},
): Promise<CarrentBridgeHandle> {
  const token = options.token ?? randomUUID();
  const bridge = new CarrentBridgeServer({
    runId: options.runId,
    token,
    catalog: options.catalog ?? createDefaultSkillCatalogService(options.homeDir),
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

function createDefaultSkillCatalogService(homeDir = os.homedir()): SkillCatalogBridgeService {
  return {
    listSkills: () => listInstalledSkills(homeDir),
    readSkill: (locator) => readSkill(locator, { homeDir }),
    listSkillResources: (locator) => listSkillResources(locator, { homeDir }),
    readSkillResource: (locator, resourcePath) =>
      readSkillResource(locator, resourcePath, { homeDir }),
  };
}

class CarrentBridgeServer {
  constructor(
    private readonly options: {
      runId?: string;
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
        headers: [],
      },
      close: () => server.close(),
    };
  }

  private async handleToolCall(params: unknown) {
    const payload = readObject(params);
    const name = readString(payload?.name);
    const args = readObject(payload?.arguments) ?? {};

    try {
      if (name === "list_skills") {
        const skills = await this.options.catalog.listSkills();
        this.audit({ toolName: name });
        return toolResult({
          skills: skills.map(formatSkillMetadata),
        });
      }

      if (name === "read_skill") {
        const result = await this.options.catalog.readSkill(readSkillLocator(args));
        this.audit({
          toolName: name,
          skillName: result.skill.name,
          skillPath: result.skill.declaredPath ?? result.skill.path,
        });
        return toolResult(formatSkillRead(result));
      }

      if (name === "list_skill_resources") {
        const result = await this.options.catalog.listSkillResources(readSkillLocator(args));
        this.audit({
          toolName: name,
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
          skillName: result.skill.name,
          skillPath: result.skill.declaredPath ?? result.skill.path,
          resourcePath: result.resource.path,
        });
        return toolResult(formatSkillResourceRead(result));
      }

      return toolError("unknown_tool", `Unknown Carrent Bridge tool: ${name ?? "unknown"}`);
    } catch (error) {
      const code = error instanceof SkillCatalogError ? error.code : "tool_error";
      return toolError(code, errorMessage(error));
    }
  }

  private audit(entry: Omit<CarrentBridgeAuditEntry, "at" | "runId">) {
    this.options.audit?.({
      at: this.options.now().toISOString(),
      runId: this.options.runId,
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
