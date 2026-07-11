import { describe, expect, it } from "bun:test";
import { request as httpRequest } from "node:http";

import { SkillCatalogError, type ResolvedSkillRecord } from "../skills/skillCatalog";
import {
  clearCarrentBridgeAuditEntries,
  getCarrentBridgeAuditEntries,
  startCarrentBridge,
  type CarrentBridgeAuditEntry,
} from "./carrentBridge";

type JsonObject = Record<string, unknown>;

const grillingSkill: ResolvedSkillRecord = {
  name: "grilling",
  description: "Interview the user relentlessly.",
  source: "agents",
  path: "/skills/grilling/SKILL.md",
  declaredPath: "/skills/grilling/SKILL.md",
  realPath: "/real/skills/grilling/SKILL.md",
  declaredRootPath: "/skills/grilling",
  realRootPath: "/real/skills/grilling",
};

async function rpc(url: string, method: string, params: JsonObject = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: `rpc-${method}`, method, params }),
  });
  return (await response.json()) as JsonObject;
}

const REQUEST_BODY_LIMIT = 1 * 1024 * 1024;

function toolCallBody(size?: number) {
  const body = Buffer.from(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "request-body-test",
      method: "tools/call",
      params: { name: "list_skills" },
    }),
  );
  if (size === undefined) {
    return body;
  }
  if (body.byteLength > size) {
    throw new Error("Requested body size is too small for the JSON-RPC fixture.");
  }
  return Buffer.concat([body, Buffer.alloc(size - body.byteLength, " ")], size);
}

async function postRaw(url: string, bodyChunks: Buffer[], headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
      },
      (response) => {
        const responseChunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => responseChunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(responseChunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    for (const chunk of bodyChunks) {
      request.write(chunk);
    }
    request.end();
  });
}

async function startRequestBodyTestBridge() {
  let toolDispatches = 0;
  const bridge = await startCarrentBridge({
    token: "request-body-test",
    catalog: {
      async listSkills() {
        toolDispatches += 1;
        return [];
      },
      async readSkill() {
        throw new Error("unused");
      },
      async listSkillResources() {
        throw new Error("unused");
      },
      async readSkillResource() {
        throw new Error("unused");
      },
    },
  });
  return { bridge, getToolDispatches: () => toolDispatches };
}

function resultObject(response: JsonObject) {
  return response.result as JsonObject;
}

describe("startCarrentBridge", () => {
  it("accepts a small authenticated request", async () => {
    const { bridge, getToolDispatches } = await startRequestBodyTestBridge();

    try {
      const response = await postRaw(bridge.mcpServer.url, [toolCallBody()]);

      expect(response.status).toBe(200);
      expect(getToolDispatches()).toBe(1);
    } finally {
      await bridge.close();
    }
  });

  it("rejects a declared request body above the limit before tool dispatch", async () => {
    const { bridge, getToolDispatches } = await startRequestBodyTestBridge();
    const body = toolCallBody(REQUEST_BODY_LIMIT + 1);

    try {
      const response = await postRaw(bridge.mcpServer.url, [body], {
        "content-length": String(body.byteLength),
      });

      expect(response.status).toBe(413);
      expect(getToolDispatches()).toBe(0);
    } finally {
      await bridge.close();
    }
  });

  it("rejects a chunked request body that crosses the limit", async () => {
    const { bridge, getToolDispatches } = await startRequestBodyTestBridge();
    const body = toolCallBody(REQUEST_BODY_LIMIT + 1);

    try {
      const response = await postRaw(bridge.mcpServer.url, [
        body.subarray(0, REQUEST_BODY_LIMIT),
        body.subarray(REQUEST_BODY_LIMIT),
      ]);

      expect(response.status).toBe(413);
      expect(getToolDispatches()).toBe(0);

      const nextResponse = await postRaw(bridge.mcpServer.url, [toolCallBody()]);
      expect(nextResponse.status).toBe(200);
      expect(getToolDispatches()).toBe(1);
    } finally {
      await bridge.close();
    }
  });

  it("parses a request body exactly at the limit", async () => {
    const { bridge, getToolDispatches } = await startRequestBodyTestBridge();
    const body = toolCallBody(REQUEST_BODY_LIMIT);

    try {
      const response = await postRaw(bridge.mcpServer.url, [body], {
        "content-length": String(body.byteLength),
      });

      expect(response.status).toBe(200);
      expect(getToolDispatches()).toBe(1);
    } finally {
      await bridge.close();
    }
  });

  it("exposes MCP skill discovery and SKILL.md reads", async () => {
    const audit: CarrentBridgeAuditEntry[] = [];
    const bridge = await startCarrentBridge({
      runId: "run-1",
      token: "test-token",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      audit: (entry) => audit.push(entry),
      catalog: {
        async listSkills() {
          return [grillingSkill];
        },
        async readSkill() {
          return { skill: grillingSkill, content: "# Grilling\n" };
        },
        async listSkillResources() {
          return { skill: grillingSkill, resources: [] };
        },
        async readSkillResource() {
          throw new Error("unused");
        },
      },
    });

    try {
      expect(bridge.mcpServer).toMatchObject({
        id: "carrent_bridge",
        name: "carrent_bridge",
        type: "http",
        headers: [],
      });
      expect(bridge.mcpServer.url).toContain("/mcp?token=test-token");

      const initialized = await rpc(bridge.mcpServer.url, "initialize", {
        protocolVersion: "2024-11-05",
      });
      expect(resultObject(initialized)).toMatchObject({
        capabilities: { tools: {} },
        serverInfo: { name: "carrent_bridge" },
      });

      const tools = await rpc(bridge.mcpServer.url, "tools/list");
      expect(((resultObject(tools).tools as JsonObject[]) ?? []).map((tool) => tool.name)).toEqual([
        "list_skills",
        "read_skill",
        "list_skill_resources",
        "read_skill_resource",
      ]);

      const listed = await rpc(bridge.mcpServer.url, "tools/call", { name: "list_skills" });
      expect(resultObject(listed).structuredContent).toEqual({
        skills: [
          {
            name: "grilling",
            description: "Interview the user relentlessly.",
            source: "agents",
            path: "/skills/grilling/SKILL.md",
            declaredPath: "/skills/grilling/SKILL.md",
            realPath: "/real/skills/grilling/SKILL.md",
            declaredRootPath: "/skills/grilling",
            realRootPath: "/real/skills/grilling",
          },
        ],
      });

      const read = await rpc(bridge.mcpServer.url, "tools/call", {
        name: "read_skill",
        arguments: { name: "grilling" },
      });
      expect(resultObject(read).structuredContent).toMatchObject({
        skill: { name: "grilling" },
        content: "# Grilling\n",
      });
      expect(audit).toEqual([
        {
          at: "2026-01-01T00:00:00.000Z",
          runId: "run-1",
          toolName: "list_skills",
        },
        {
          at: "2026-01-01T00:00:00.000Z",
          runId: "run-1",
          toolName: "read_skill",
          skillName: "grilling",
          skillPath: "/skills/grilling/SKILL.md",
        },
      ]);
    } finally {
      await bridge.close();
    }
  });

  it("exposes resource tools and returns structured tool errors", async () => {
    const bridge = await startCarrentBridge({
      token: "resource-token",
      catalog: {
        async listSkills() {
          return [grillingSkill];
        },
        async readSkill() {
          return { skill: grillingSkill, content: "# Grilling\n" };
        },
        async listSkillResources() {
          return { skill: grillingSkill, resources: [{ path: "references/a.md", size: 7 }] };
        },
        async readSkillResource(_locator, resourcePath) {
          if (resourcePath === "references/a.md") {
            return {
              skill: grillingSkill,
              resource: { path: resourcePath, size: 7 },
              content: "details",
            };
          }

          throw new SkillCatalogError("resource_not_found", "not found");
        },
      },
    });

    try {
      const listed = await rpc(bridge.mcpServer.url, "tools/call", {
        name: "list_skill_resources",
        arguments: { name: "grilling" },
      });
      expect(resultObject(listed).structuredContent).toMatchObject({
        skill: { name: "grilling" },
        resources: [{ path: "references/a.md", size: 7 }],
      });

      const read = await rpc(bridge.mcpServer.url, "tools/call", {
        name: "read_skill_resource",
        arguments: { name: "grilling", resourcePath: "references/a.md" },
      });
      expect(resultObject(read).structuredContent).toMatchObject({
        skill: { name: "grilling" },
        resource: { path: "references/a.md", size: 7 },
        content: "details",
      });

      const missing = await rpc(bridge.mcpServer.url, "tools/call", {
        name: "read_skill_resource",
        arguments: { name: "grilling", resourcePath: "missing.md" },
      });
      expect(resultObject(missing)).toMatchObject({
        isError: true,
        structuredContent: { error: { code: "resource_not_found", message: "not found" } },
      });
    } finally {
      await bridge.close();
    }
  });

  it("records skill reads through the default audit sink", async () => {
    clearCarrentBridgeAuditEntries();
    const bridge = await startCarrentBridge({
      runId: "run-default-audit",
      token: "default-audit-token",
      now: () => new Date("2026-01-02T00:00:00.000Z"),
      catalog: {
        async listSkills() {
          return [grillingSkill];
        },
        async readSkill() {
          return { skill: grillingSkill, content: "# Grilling\n" };
        },
        async listSkillResources() {
          return { skill: grillingSkill, resources: [] };
        },
        async readSkillResource() {
          throw new Error("unused");
        },
      },
    });

    try {
      await rpc(bridge.mcpServer.url, "tools/call", {
        name: "read_skill",
        arguments: { name: "grilling" },
      });

      expect(getCarrentBridgeAuditEntries()).toEqual([
        {
          at: "2026-01-02T00:00:00.000Z",
          runId: "run-default-audit",
          toolName: "read_skill",
          skillName: "grilling",
          skillPath: "/skills/grilling/SKILL.md",
        },
      ]);
    } finally {
      await bridge.close();
      clearCarrentBridgeAuditEntries();
    }
  });
});
