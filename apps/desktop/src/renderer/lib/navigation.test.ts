import { describe, expect, it } from "bun:test";

import type {
  AppProjectRecord,
  AppThreadRecord,
  WorkspaceProjectAssociationRecord,
  WorkspaceRecord,
} from "../../shared/workspacePersistence";
import {
  buildProjectPath,
  buildThreadPath,
  buildWorkspacePath,
  resolveThreeLevelRoute,
} from "./navigation";

const workspaces: WorkspaceRecord[] = [
  { id: "workspace-1", name: "Personal", order: 0 },
  { id: "workspace-2", name: "Client", order: 1 },
];
const projects: AppProjectRecord[] = [
  { id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" },
];
const associations: WorkspaceProjectAssociationRecord[] = [
  {
    workspaceId: "workspace-1",
    projectId: "project-1",
    order: 0,
    defaultProviderProfileId: "default",
    defaultAgentMode: "ask",
  },
];
const threads: AppThreadRecord[] = [
  {
    id: "thread-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    title: "Navigation",
    createdAt: "2026-07-27T08:00:00.000Z",
    lastActivityAt: "2026-07-27T08:00:00.000Z",
    providerProfileId: "default",
    agentMode: "ask",
  },
];

describe("three-level navigation", () => {
  it("builds stable ID-only paths", () => {
    expect(buildWorkspacePath("workspace-1")).toBe("/workspace/workspace-1");
    expect(buildProjectPath("workspace-1", "project-1")).toBe(
      "/workspace/workspace-1/project/project-1",
    );
    expect(buildThreadPath("workspace-1", "project-1", "thread-1")).toBe(
      "/workspace/workspace-1/project/project-1/thread/thread-1",
    );
  });

  it("validates the full ownership chain and falls back to the nearest valid parent", () => {
    const state = { workspaces, projects, associations, threads };

    expect(resolveThreeLevelRoute(state, "/workspace/workspace-1")).toEqual({
      kind: "workspace",
      workspaceId: "workspace-1",
    });
    expect(
      resolveThreeLevelRoute(state, "/workspace/workspace-1/project/project-1/thread/thread-1"),
    ).toEqual({
      kind: "thread",
      workspaceId: "workspace-1",
      projectId: "project-1",
      threadId: "thread-1",
    });
    expect(
      resolveThreeLevelRoute(state, "/workspace/workspace-2/project/project-1/thread/thread-1"),
    ).toEqual({
      kind: "fallback",
      to: "/workspace/workspace-2",
      notice: "Project is not available in this Workspace.",
    });
    expect(
      resolveThreeLevelRoute(state, "/workspace/workspace-1/project/project-1/thread/missing"),
    ).toEqual({
      kind: "fallback",
      to: "/workspace/workspace-1/project/project-1",
      notice: "Thread could not be found.",
    });
    expect(resolveThreeLevelRoute(state, "/workspace/missing/project/project-1")).toEqual({
      kind: "fallback",
      to: "/",
      notice: "Workspace could not be found.",
    });
  });

  it("redirects archived Thread routes to the Project without a notice", () => {
    const state = {
      workspaces,
      projects,
      associations,
      threads: threads.map((thread) => ({ ...thread, archived: true })),
    };

    expect(
      resolveThreeLevelRoute(state, "/workspace/workspace-1/project/project-1/thread/thread-1"),
    ).toEqual({
      kind: "fallback",
      to: "/workspace/workspace-1/project/project-1",
      notice: null,
    });
  });

  it("rejects Workspace, Project, and Thread routes with extra path segments", () => {
    const state = { workspaces, projects, associations, threads };

    expect(resolveThreeLevelRoute(state, "/workspace/workspace-1/extra")).toEqual({
      kind: "fallback",
      to: "/workspace/workspace-1",
      notice: "Project is not available in this Workspace.",
    });
    expect(resolveThreeLevelRoute(state, "/workspace/workspace-1/project/project-1/extra")).toEqual(
      {
        kind: "fallback",
        to: "/workspace/workspace-1/project/project-1",
        notice: "Thread could not be found.",
      },
    );
    expect(
      resolveThreeLevelRoute(
        state,
        "/workspace/workspace-1/project/project-1/thread/thread-1/extra",
      ),
    ).toEqual({
      kind: "fallback",
      to: "/workspace/workspace-1/project/project-1",
      notice: "Thread could not be found.",
    });
  });
});
