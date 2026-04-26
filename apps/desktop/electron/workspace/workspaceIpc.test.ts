import { describe, expect, it } from "bun:test";
import { getLastWorkspaceSnapshot, registerWorkspaceIpc } from "./workspaceIpc";
import type { WorkspaceSnapshot, ProviderSessionSnapshot } from "../../src/shared/workspacePersistence";

describe("registerWorkspaceIpc", () => {
  it("registers workspace and provider session channels", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on(channel, listener) {
          listeners.set(channel, listener);
        },
      },
      {
        loadWorkspaceSnapshot: async () => null,
        saveWorkspaceSnapshot: async () => {},
        loadProviderSessions: async () => ({ version: 1, sessions: {} }),
        saveProviderSessions: async () => {},
      },
    );

    expect([...handlers.keys()].sort()).toEqual([
      "provider-sessions:load",
      "provider-sessions:save",
      "workspace:load",
      "workspace:save",
    ]);
    expect([...listeners.keys()]).toEqual(["workspace:remember"]);
  });

  it("workspace:load returns snapshot from store", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on() {},
      },
      {
        loadWorkspaceSnapshot: async () => snapshot,
        saveWorkspaceSnapshot: async () => {},
        loadProviderSessions: async () => ({ version: 1, sessions: {} }),
        saveProviderSessions: async () => {},
      },
    );

    const result = await handlers.get("workspace:load")?.({});
    expect(result).toEqual(snapshot);
  });

  it("workspace:save forwards snapshot to store", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const saved: WorkspaceSnapshot[] = [];
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on() {},
      },
      {
        loadWorkspaceSnapshot: async () => null,
        saveWorkspaceSnapshot: async (s) => {
          saved.push(s);
        },
        loadProviderSessions: async () => ({ version: 1, sessions: {} }),
        saveProviderSessions: async () => {},
      },
    );

    await handlers.get("workspace:save")?.({}, snapshot);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(snapshot);
    expect(getLastWorkspaceSnapshot()).toEqual(snapshot);
  });

  it("workspace:remember updates the latest snapshot without writing to disk", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const saved: WorkspaceSnapshot[] = [];
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [{ id: "p2", name: "P2", path: "/tmp/p2", threads: [] }],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on(channel, listener) {
          listeners.set(channel, listener);
        },
      },
      {
        loadWorkspaceSnapshot: async () => null,
        saveWorkspaceSnapshot: async (s) => {
          saved.push(s);
        },
        loadProviderSessions: async () => ({ version: 1, sessions: {} }),
        saveProviderSessions: async () => {},
      },
    );

    listeners.get("workspace:remember")?.({}, snapshot);
    expect(getLastWorkspaceSnapshot()).toEqual(snapshot);
    expect(saved).toHaveLength(0);
  });

  it("provider-sessions:load returns sessions from store", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const sessions: ProviderSessionSnapshot = { version: 1, sessions: { k1: "s1" } };

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on() {},
      },
      {
        loadWorkspaceSnapshot: async () => null,
        saveWorkspaceSnapshot: async () => {},
        loadProviderSessions: async () => sessions,
        saveProviderSessions: async () => {},
      },
    );

    const result = await handlers.get("provider-sessions:load")?.({});
    expect(result).toEqual(sessions);
  });
});
