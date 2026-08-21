import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { classifyToolApproval } from "./approvalPolicy";

describe("classifyToolApproval", () => {
  it("implements the Ask, Auto Edit, and Full Project permission matrix", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-"));

    expect(
      (
        await classifyToolApproval({
          toolName: "read",
          args: { path: "." },
          workingDirectory: project,
          mode: "ask",
        })
      ).requiresApproval,
    ).toBe(false);
    expect(
      (
        await classifyToolApproval({
          toolName: "write",
          args: { path: "a.ts" },
          workingDirectory: project,
          mode: "ask",
        })
      ).requiresApproval,
    ).toBe(true);
    expect(
      (
        await classifyToolApproval({
          toolName: "write",
          args: { path: "a.ts" },
          workingDirectory: project,
          mode: "auto-edit",
        })
      ).requiresApproval,
    ).toBe(false);
    expect(
      (
        await classifyToolApproval({
          toolName: "bash",
          args: { command: "git status" },
          workingDirectory: project,
          mode: "auto-edit",
        })
      ).requiresApproval,
    ).toBe(true);
    expect(
      (
        await classifyToolApproval({
          toolName: "bash",
          args: { command: "git status" },
          workingDirectory: project,
          mode: "full-project",
        })
      ).requiresApproval,
    ).toBe(false);
  });

  it("always asks for external paths, network access, and dangerous commands", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-"));

    expect(
      (
        await classifyToolApproval({
          toolName: "read",
          args: { path: "../outside.txt" },
          workingDirectory: project,
          mode: "full-project",
        })
      ).requiresApproval,
    ).toBe(true);
    expect(
      (
        await classifyToolApproval({
          toolName: "bash",
          args: { command: "curl https://example.com" },
          workingDirectory: project,
          mode: "full-project",
        })
      ).requiresApproval,
    ).toBe(true);
    expect(
      (
        await classifyToolApproval({
          toolName: "bash",
          args: { command: "rm -rf ./build" },
          workingDirectory: project,
          mode: "full-project",
        })
      ).requiresApproval,
    ).toBe(true);
  });

  it("allows explicitly authorized external reads in every mode, but never writes", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-project-"));
    const skillRoot = await mkdtemp(path.join(os.tmpdir(), "carrent-approval-skill-"));
    const resourceDirectory = path.join(skillRoot, "references");
    const skillFile = path.join(resourceDirectory, "SKILL.md");
    await mkdir(resourceDirectory);
    await writeFile(skillFile, "skill instructions");

    expect(
      (
        await classifyToolApproval({
          toolName: "read",
          args: { path: skillFile },
          workingDirectory: project,
          mode: "full-project",
          additionalReadPaths: [skillRoot],
        })
      ).requiresApproval,
    ).toBe(false);
    expect(
      (
        await classifyToolApproval({
          toolName: "read",
          args: { path: skillFile },
          workingDirectory: project,
          mode: "ask",
          additionalReadPaths: [skillRoot],
        })
      ).requiresApproval,
    ).toBe(false);
    expect(
      (
        await classifyToolApproval({
          toolName: "write",
          args: { path: skillFile },
          workingDirectory: project,
          mode: "full-project",
          additionalReadPaths: [skillRoot],
        })
      ).requiresApproval,
    ).toBe(true);
  });
});
