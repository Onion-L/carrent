import { describe, expect, it } from "bun:test";

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

function resultObject(response: JsonObject) {
  return response.result as JsonObject;
}

describe("startCarrentBridge", () => {
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
