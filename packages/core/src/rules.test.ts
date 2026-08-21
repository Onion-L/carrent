import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { classifyCommand } from "./commandPolicy";
import { loadPermissionRules } from "./rules";

describe("permission rules", () => {
  it("loads user rules and project rules once with sorted project files", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "carrent-rules-home-"));
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-rules-project-"));
    await mkdir(path.join(home, ".carrent", "rules"), { recursive: true });
    await mkdir(path.join(project, ".carrent", "rules"), { recursive: true });
    await writeFile(
      path.join(home, ".carrent", "rules", "default.rules.json"),
      JSON.stringify([{ prefix: ["git", "push"], decision: "allow" }]),
    );
    await writeFile(
      path.join(project, ".carrent", "rules", "10-tighten.rules.json"),
      JSON.stringify([{ prefix: ["git", "push"], decision: "prompt" }]),
    );
    const rules = await loadPermissionRules({ homeDirectory: home, projectDirectory: project });
    expect(rules.user[0]?.decision).toBe("allow");
    expect(rules.project[0]?.decision).toBe("prompt");
    expect(
      classifyCommand("git push origin main", project, "full-access", rules).requiresApproval,
    ).toBe(true);
  });

  it("lets an explicit user allow override built-in danger but never forbidden or project prompt", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-rules-project-"));
    const user = {
      user: [{ prefix: ["git", "push", "--force"], decision: "allow" as const }],
      project: [],
      malformed: false,
    };
    expect(classifyCommand("git push --force", project, "full-access", user).requiresApproval).toBe(
      false,
    );
    expect(
      classifyCommand("git push --force", project, "full-access", {
        ...user,
        project: [{ prefix: ["git", "push"], decision: "prompt" as const }],
      }).requiresApproval,
    ).toBe(true);
    expect(
      classifyCommand("git push --force", project, "full-access", {
        ...user,
        user: [...user.user, { prefix: ["git", "push"], decision: "forbidden" as const }],
      }).blocked,
    ).toBe(true);
  });

  it("fails closed on malformed user or project rule files", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "carrent-rules-home-"));
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-rules-project-"));
    await mkdir(path.join(home, ".carrent", "rules"), { recursive: true });
    await writeFile(path.join(home, ".carrent", "rules", "default.rules.json"), "not json");
    const rules = await loadPermissionRules({ homeDirectory: home, projectDirectory: project });
    expect(rules.malformed).toBe(true);
    expect(classifyCommand("git status", project, "full-access", rules).requiresApproval).toBe(
      true,
    );
  });

  it("ignores project allow rules because project policy is tighten-only", () => {
    const project = "/tmp/carrent-rules-project";
    const rules = {
      user: [],
      project: [{ prefix: ["git", "status"], decision: "allow" as const }],
      malformed: false,
    };
    expect(classifyCommand("git status", project, "read-only", rules).requiresApproval).toBe(true);
  });
});
