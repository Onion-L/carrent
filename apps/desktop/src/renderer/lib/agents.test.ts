import { describe, expect, it } from "bun:test";
import {
  buildNewAgent,
  deleteAgentFromList,
  getSelectableAgentId,
  updateAgentInList,
  validateAgent,
} from "./agents";
import type { AgentRecord } from "../mock/uiShellData";

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    name: "Test",
    runtime: "codex",
    responsibility: "You are a test agent.",
    ...overrides,
  };
}

describe("buildNewAgent", () => {
  it("creates a valid draft agent", () => {
    const agent = buildNewAgent();
    expect(agent.id).toBeString();
    expect(agent.id.length).toBeGreaterThan(0);
    expect(agent.name).toBe("");
    expect(agent.responsibility).toBe("");
    expect(agent.runtime).toBe("codex");
    expect(agent.createdAt).toBeString();
    expect(agent.updatedAt).toBeString();
    expect(validateAgent(agent)).toBeString();
  });
});

describe("validateAgent", () => {
  it("rejects blank name", () => {
    const agent = makeAgent({ name: "" });
    expect(validateAgent(agent)).toBe("Name is required.");
  });

  it("rejects blank name with only whitespace", () => {
    const agent = makeAgent({ name: "   " });
    expect(validateAgent(agent)).toBe("Name is required.");
  });

  it("rejects blank responsibility", () => {
    const agent = makeAgent({ responsibility: "" });
    expect(validateAgent(agent)).toBe("Responsibility is required.");
  });

  it("rejects blank responsibility with only whitespace", () => {
    const agent = makeAgent({ responsibility: "  " });
    expect(validateAgent(agent)).toBe("Responsibility is required.");
  });

  it("rejects invalid runtime", () => {
    const agent = makeAgent({ runtime: "invalid" as "codex" });
    expect(validateAgent(agent)).toBe("Runtime must be codex or claude-code.");
  });

  it("accepts a valid agent", () => {
    const agent = makeAgent();
    expect(validateAgent(agent) === null).toBe(true);
  });
});

describe("getSelectableAgentId", () => {
  it("returns null when list is empty", () => {
    expect(getSelectableAgentId([]) === null).toBe(true);
  });

  it("returns preferred id when it exists", () => {
    const agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    expect(getSelectableAgentId(agents, "a2")).toBe("a2");
  });

  it("falls back to first agent when preferred id is missing", () => {
    const agents = [makeAgent({ id: "a1" })];
    expect(getSelectableAgentId(agents, "missing")).toBe("a1");
  });

  it("falls back to first agent when preferred id is null", () => {
    const agents = [makeAgent({ id: "a1" })];
    expect(getSelectableAgentId(agents, null)).toBe("a1");
  });
});

describe("updateAgentInList", () => {
  it("updates an existing agent and refreshes updatedAt", () => {
    const agents = [makeAgent({ id: "a1", name: "Old" })];
    const updated = updateAgentInList(agents, makeAgent({ id: "a1", name: "New" }));
    expect(updated[0].name).toBe("New");
    expect(updated[0].updatedAt).not.toBe(agents[0].updatedAt);
  });

  it("returns unchanged list when agent id is not found", () => {
    const agents = [makeAgent({ id: "a1" })];
    const updated = updateAgentInList(agents, makeAgent({ id: "missing" }));
    expect(updated).toBe(agents);
  });
});

describe("deleteAgentFromList", () => {
  it("deletes an agent and returns the next selectable id", () => {
    const agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    const result = deleteAgentFromList(agents, "a1", "a1");
    expect(result.agents.length).toBe(1);
    expect(result.agents[0].id).toBe("a2");
    expect(result.nextSelectedId).toBe("a2");
  });

  it("returns null for nextSelectedId when list becomes empty", () => {
    const agents = [makeAgent({ id: "a1" })];
    const result = deleteAgentFromList(agents, "a1", "a1");
    expect(result.agents.length).toBe(0);
    expect(result.nextSelectedId === null).toBe(true);
  });

  it("preserves current selected when it is not the deleted agent", () => {
    const agents = [makeAgent({ id: "a1" }), makeAgent({ id: "a2" })];
    const result = deleteAgentFromList(agents, "a1", "a2");
    expect(result.nextSelectedId).toBe("a2");
  });
});
