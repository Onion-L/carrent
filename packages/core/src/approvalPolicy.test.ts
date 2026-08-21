import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { classifyToolApproval } from "./approvalPolicy";

describe("classifyToolApproval", () => {
  it("runs reads free in every mode, including outside the project", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-outside-"));
    const outsideFile = path.join(outside, "notes.txt");
    await writeFile(outsideFile, "hello");

    for (const access of ["read-only", "workspace-write", "full-access"] as const) {
      expect(
        (await classifyToolApproval({ toolName: "read", args: { path: "." }, workingDirectory: project, access }))
          .requiresApproval,
      ).toBe(false);
      expect(
        (await classifyToolApproval({ toolName: "read", args: { path: outsideFile }, workingDirectory: project, access }))
          .requiresApproval,
      ).toBe(false);
      expect(
        (await classifyToolApproval({ toolName: "grep", args: { path: outside }, workingDirectory: project, access }))
          .requiresApproval,
      ).toBe(false);
    }
  });

  it("prompts for every write under read-only and runs project writes free under writable modes", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-"));

    for (const toolName of ["write", "edit"]) {
      expect(
        (await classifyToolApproval({ toolName, args: { path: "a.ts" }, workingDirectory: project, access: "read-only" }))
          .requiresApproval,
      ).toBe(true);
      for (const access of ["workspace-write", "full-access"] as const) {
        expect(
          (await classifyToolApproval({ toolName, args: { path: "a.ts" }, workingDirectory: project, access }))
            .requiresApproval,
        ).toBe(false);
      }
    }
  });

  it("prompts for writes outside the project in every mode", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-outside-"));

    for (const access of ["read-only", "workspace-write", "full-access"] as const) {
      expect(
        (
          await classifyToolApproval({
            toolName: "write",
            args: { path: path.join(outside, "x.ts") },
            workingDirectory: project,
            access,
          })
        ).requiresApproval,
      ).toBe(true);
    }
  });

  it("keeps .git and .carrent read-only under workspace-write", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-"));

    for (const target of [".git/config", ".carrent/rules/x.json"]) {
      expect(
        (
          await classifyToolApproval({
            toolName: "write",
            args: { path: target },
            workingDirectory: project,
            access: "workspace-write",
          })
        ).requiresApproval,
      ).toBe(true);
      expect(
        (
          await classifyToolApproval({
            toolName: "write",
            args: { path: target },
            workingDirectory: project,
            access: "full-access",
          })
        ).requiresApproval,
      ).toBe(false);
    }
  });

  it("runs safe in-project bash free under writable modes and prompts under read-only", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-"));

    expect(
      (await classifyToolApproval({ toolName: "bash", args: { command: "git status" }, workingDirectory: project, access: "read-only" }))
        .requiresApproval,
    ).toBe(true);
    for (const access of ["workspace-write", "full-access"] as const) {
      expect(
        (await classifyToolApproval({ toolName: "bash", args: { command: "git status" }, workingDirectory: project, access }))
          .requiresApproval,
      ).toBe(false);
    }
  });

  it("prompts for network, dangerous, and outside-referencing bash in every mode", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-"));

    for (const access of ["read-only", "workspace-write", "full-access"] as const) {
      for (const command of ["curl https://example.com", "rm -rf ./build", "cat /etc/hosts"]) {
        expect(
          (await classifyToolApproval({ toolName: "bash", args: { command }, workingDirectory: project, access }))
            .requiresApproval,
        ).toBe(true);
      }
    }
  });

  it("prompts for unknown tools", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-"));

    const classification = await classifyToolApproval({
      toolName: "mcp__something",
      args: {},
      workingDirectory: project,
      access: "full-access",
    });
    expect(classification.action).toBe("dangerous");
    expect(classification.requiresApproval).toBe(true);
  });
});
