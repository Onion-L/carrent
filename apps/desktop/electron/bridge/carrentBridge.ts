import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";

import type { SkillRecord } from "../../src/shared/skills";
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

type JsonRpcId = string | number | null;
type JsonObject = Record<string, unknown>;

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
const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;
const defaultAuditEntries: CarrentBridgeAuditEntry[] = [];

class RequestBodyTooLargeError extends Error {}

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
  private server: Server | null = null;

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
    this.server = createServer((request, response) => {
      void this.handleHttpRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });

    const address = this.server.address() as AddressInfo | null;
    if (!address) {
      throw new Error("Carrent Bridge did not receive a local port.");
    }

    const url = `http://127.0.0.1:${address.port}/mcp?token=${encodeURIComponent(
      this.options.token,
    )}`;

    return {
      mcpServer: {
        id: "carrent_bridge",
        name: "carrent_bridge",
        type: "http",
        url,
        headers: [],
      },
      close: () => this.close(),
    };
  }

  private async close() {
    const server = this.server;
    this.server = null;
    if (!server || !server.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "POST" || requestUrl.pathname !== "/mcp") {
        sendText(response, 404, "Not found");
        return;
      }

      if (requestUrl.searchParams.get("token") !== this.options.token) {
        sendText(response, 401, "Unauthorized");
        return;
      }

      const message = JSON.parse(await readRequestBody(request)) as unknown;
      const result = Array.isArray(message)
        ? await Promise.all(message.map((item) => this.handleJsonRpc(item)))
        : await this.handleJsonRpc(message);

      if (result === null || (Array.isArray(result) && result.length === 0)) {
        response.writeHead(204);
        response.end();
        return;
      }

      sendJson(response, 200, result);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        sendText(response, 413, "Payload too large");
        return;
      }

      sendJson(response, 200, jsonRpcError(null, -32700, errorMessage(error)));
    }
  }

  private async handleJsonRpc(message: unknown): Promise<JsonObject | null> {
    const request = readObject(message);
    const id = readJsonRpcId(request?.id);
    const method = readString(request?.method);
    if (!request || !method) {
      return jsonRpcError(id, -32600, "Invalid JSON-RPC request.");
    }

    try {
      if (method === "initialize") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion:
              readString(readObject(request.params)?.protocolVersion) ?? "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "carrent_bridge", version: "0.1.0" },
          },
        };
      }

      if (method === "notifications/initialized") {
        return null;
      }

      if (method === "tools/list") {
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: TOOL_DEFINITIONS },
        };
      }

      if (method === "tools/call") {
        return {
          jsonrpc: "2.0",
          id,
          result: await this.handleToolCall(request.params),
        };
      }

      return jsonRpcError(id, -32601, `Unsupported Carrent Bridge method: ${method}`);
    } catch (error) {
      return jsonRpcError(id, -32000, errorMessage(error));
    }
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

function toolResult(value: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }, null, 2) }],
    structuredContent: { error: { code, message } },
  };
}

async function readRequestBody(request: IncomingMessage) {
  const contentLength = request.headers["content-length"];
  if (
    typeof contentLength === "string" &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_REQUEST_BODY_BYTES
  ) {
    await drainRequest(request);
    throw new RequestBodyTooLargeError();
  }

  return new Promise<string>((resolve, reject) => {
    let chunks: Buffer[] = [];
    let receivedBytes = 0;
    let tooLarge = false;

    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    };
    const onData = (chunk: Buffer | string) => {
      if (tooLarge) {
        return;
      }

      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.byteLength;
      if (receivedBytes > MAX_REQUEST_BODY_BYTES) {
        tooLarge = true;
        chunks = [];
        return;
      }

      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      if (tooLarge) {
        reject(new RequestBodyTooLargeError());
        return;
      }

      resolve(Buffer.concat(chunks, receivedBytes).toString("utf8"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(tooLarge ? new RequestBodyTooLargeError() : error);
    };

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

function drainRequest(request: IncomingMessage) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      request.off("end", finish);
      request.off("error", finish);
      resolve();
    };
    request.once("end", finish);
    request.once("error", finish);
    request.resume();
  });
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendText(response: ServerResponse, statusCode: number, value: string) {
  response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  response.end(value);
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function readObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readJsonRpcId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
