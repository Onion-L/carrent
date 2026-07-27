import { afterEach, describe, expect, it } from "bun:test";

import "./test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import type { AppStateSnapshot, WorkspaceSnapshot } from "../shared/workspacePersistence";
import App from "./App";

const legacySnapshot: WorkspaceSnapshot = {
  version: 1,
  projects: [],
  chats: [],
  messages: [],
  activeThreadId: null,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function installBridge(
  appState: AppStateSnapshot | null,
  saved: AppStateSnapshot[],
  selectedDirectories: string[] = [],
) {
  window.carrent = {
    appState: {
      load: async () => appState,
      save: async (snapshot: AppStateSnapshot) => {
        saved.push(structuredClone(snapshot));
      },
    },
    dialog: {
      openDirectory: async () => {
        const selected = selectedDirectories.shift();
        return selected
          ? { canceled: false, filePaths: [selected] }
          : { canceled: true, filePaths: [] };
      },
    },
    workspace: {
      load: async () => legacySnapshot,
      remember: () => {},
      save: async () => {},
    },
    runtimes: {
      list: async () => [],
      listModels: async () => ({ state: "listed", models: [] }),
    },
    mcpServer: {
      getStatus: async () => ({ enabled: false, running: false }),
      start: async () => ({ enabled: true, running: true }),
      stop: async () => ({ enabled: false, running: false }),
    },
    providerSessions: {
      load: async () => ({ version: 1, sessions: {} }),
      save: async () => {},
    },
    skills: { list: async () => [] },
    chat: {
      onEvent: () => () => {},
      deleteThreadData: async () => {},
    },
  } as unknown as Window["carrent"];
}

async function renderApp(
  appState: AppStateSnapshot | null,
  initialEntry = "/",
  selectedDirectories: string[] = [],
) {
  const saved: AppStateSnapshot[] = [];
  installBridge(appState, saved, selectedDirectories);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return saved;
}

function buttonNamed(name: string) {
  const button = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`Button not found: ${name}`);
  return button;
}

async function fillInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "a" }));
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  localStorage.clear();
  root = null;
  container = null;
});

describe("Workspace App State foundation", () => {
  it("creates the first Workspace from the global first-use state", async () => {
    const saved = await renderApp(null);

    expect(container!.textContent).toContain("Create your first Workspace");
    expect(container!.textContent).not.toContain("Select a thread to start");

    const input = container!.querySelector<HTMLInputElement>('input[name="workspaceName"]')!;
    await fillInput(input, "  Personal  ");
    await click(buttonNamed("Create Workspace"));

    expect(saved).toHaveLength(1);
    expect(saved[0].workspaces).toEqual([
      { id: saved[0].workspaces[0].id, name: "Personal", order: 0 },
    ]);
    expect(saved[0].activeWorkspaceId).toBe(saved[0].workspaces[0].id);
    expect(container!.textContent).toContain("Personal");
    expect(container!.textContent).toContain("This Workspace has no Projects yet.");
  });

  it("creates, renames, and switches Workspaces without changing identity or order", async () => {
    const saved = await renderApp(
      {
        version: 1,
        workspaces: [
          { id: "workspace-1", name: "Personal", order: 0 },
          { id: "workspace-2", name: "Client", order: 1 },
        ],
        projects: [],
        associations: [],
        activeWorkspaceId: "workspace-1",
      },
      "/workspace/workspace-1",
    );

    await click(buttonNamed("Rename Workspace"));
    const renameInput = container!.querySelector<HTMLInputElement>('input[name="workspaceName"]')!;
    await fillInput(renameInput, " client ");
    await click(buttonNamed("Rename"));
    expect(container!.textContent).toContain("Workspace names must be unique.");
    expect(saved).toHaveLength(0);

    await fillInput(renameInput, "Home");
    await click(buttonNamed("Rename"));
    expect(saved.at(-1)?.workspaces).toEqual([
      { id: "workspace-1", name: "Home", order: 0 },
      { id: "workspace-2", name: "Client", order: 1 },
    ]);

    await click(buttonNamed("Client"));
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-2");
    expect(container!.querySelector("h1")?.textContent).toBe("Client");

    const saveCount = saved.length;
    await click(buttonNamed("Client"));
    expect(saved).toHaveLength(saveCount);

    await click(buttonNamed("Create Workspace"));
    const createInput = container!.querySelector<HTMLInputElement>('input[name="workspaceName"]')!;
    await fillInput(createInput, "Research");
    await click(buttonNamed("Create"));

    expect(saved.at(-1)?.workspaces.at(-1)).toEqual({
      id: saved.at(-1)!.activeWorkspaceId,
      name: "Research",
      order: 2,
    });
    expect(container!.querySelector("h1")?.textContent).toBe("Research");
  });

  it("restores the persisted active Workspace after restart", async () => {
    await renderApp({
      version: 1,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      projects: [],
      associations: [],
      activeWorkspaceId: "workspace-2",
    });

    expect(container!.querySelector("h1")?.textContent).toBe("Client");
    expect(buttonNamed("Personal").getAttribute("aria-current")).toBe(null);
    expect(buttonNamed("Client").getAttribute("aria-current")).toBe("page");
  });

  it("synchronizes the selected Workspace when navigation opens another valid overview", async () => {
    const saved = await renderApp(
      {
        version: 1,
        workspaces: [
          { id: "workspace-1", name: "Personal", order: 0 },
          { id: "workspace-2", name: "Client", order: 1 },
        ],
        projects: [],
        associations: [],
        activeWorkspaceId: "workspace-1",
      },
      "/workspace/workspace-2",
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-2");
    expect(container!.querySelector("h1")?.textContent).toBe("Client");
    expect(buttonNamed("Client").getAttribute("aria-current")).toBe("page");
  });
});

describe("Workspace Projects and Associations", () => {
  const emptyWorkspaceState: AppStateSnapshot = {
    version: 1,
    workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
    projects: [],
    associations: [],
    activeWorkspaceId: "workspace-1",
  };

  it("adds a new Project and Association atomically, then opens its overview", async () => {
    const saved = await renderApp(emptyWorkspaceState, "/workspace/workspace-1", ["/code/carrent"]);

    expect(container!.textContent).toContain(
      "Carrent never moves or copies the selected directory.",
    );
    await click(buttonNamed("Add Project"));

    expect(saved).toHaveLength(1);
    expect(saved[0].projects).toEqual([
      {
        id: saved[0].projects[0].id,
        name: "carrent",
        workingDirectory: "/code/carrent",
      },
    ]);
    expect(saved[0].associations).toEqual([
      {
        workspaceId: "workspace-1",
        projectId: saved[0].projects[0].id,
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
    ]);
    expect(container!.querySelector("h1")?.textContent).toBe("carrent");
    expect(container!.textContent).toContain("/code/carrent");
  });

  it("reuses a known Project across Workspaces and ignores a duplicate Association", async () => {
    const state: AppStateSnapshot = {
      version: 1,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      activeWorkspaceId: "workspace-2",
    };
    const saved = await renderApp(state, "/workspace/workspace-2", [
      "/code/carrent",
      "/code/carrent",
    ]);

    await click(buttonNamed("Add Project"));
    expect(saved).toHaveLength(1);
    expect(saved[0].projects).toEqual(state.projects);
    expect(saved[0].associations).toHaveLength(2);
    expect(saved[0].associations[1]).toMatchObject({
      workspaceId: "workspace-2",
      projectId: "project-1",
      order: 0,
    });

    await click(buttonNamed("Add Project"));
    expect(saved).toHaveLength(1);
  });

  function sharedProjectState(): AppStateSnapshot {
    return {
      version: 1,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
        {
          workspaceId: "workspace-2",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      activeWorkspaceId: "workspace-1",
    };
  }

  it("sets and clears a Workspace-local Project alias", async () => {
    const state = sharedProjectState();
    const saved = await renderApp(state, "/workspace/workspace-1/project/project-1");

    const aliasInput = container!.querySelector<HTMLInputElement>('input[name="projectAlias"]')!;
    await fillInput(aliasInput, "Personal Carrent");
    await click(buttonNamed("Save Alias"));

    expect(saved.at(-1)?.associations[0].alias).toBe("Personal Carrent");
    expect(saved.at(-1)?.associations[1]).toEqual(state.associations[1]);
    expect(container!.querySelector("h1")?.textContent).toBe("Personal Carrent");

    const savedAliasInput = container!.querySelector<HTMLInputElement>(
      'input[name="projectAlias"]',
    )!;
    await fillInput(savedAliasInput, "");
    await click(buttonNamed("Save Alias"));
    expect(saved.at(-1)?.associations[0].alias).toBeUndefined();
    expect(container!.querySelector("h1")?.textContent).toBe("Carrent");
  });

  it("updates Thread defaults for only the current Association", async () => {
    const state = sharedProjectState();
    const saved = await renderApp(state, "/workspace/workspace-1/project/project-1");

    const runtimeSelect = container!.querySelector<HTMLSelectElement>(
      'select[name="defaultRuntimeId"]',
    )!;
    await act(async () => {
      runtimeSelect.value = "codex";
      runtimeSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const modelInput = container!.querySelector<HTMLInputElement>(
      'input[name="defaultRuntimeModelId"]',
    )!;
    await fillInput(modelInput, "gpt-5");
    const modeSelect = container!.querySelector<HTMLSelectElement>(
      'select[name="defaultRuntimeMode"]',
    )!;
    await act(async () => {
      modeSelect.value = "full-access";
      modeSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await click(buttonNamed("Save Thread Defaults"));

    expect(saved.at(-1)?.associations[0]).toMatchObject({
      defaultRuntimeId: "codex",
      defaultRuntimeModelId: "gpt-5",
      defaultRuntimeMode: "full-access",
    });
    expect(saved.at(-1)?.associations[1]).toEqual(state.associations[1]);
  });

  it("warns and renames the shared Project across Associations", async () => {
    const saved = await renderApp(sharedProjectState(), "/workspace/workspace-1/project/project-1");

    const sharedNameInput = container!.querySelector<HTMLInputElement>(
      'input[name="sharedProjectName"]',
    )!;
    await fillInput(sharedNameInput, "Carrent Desktop");
    expect(container!.textContent).toContain("affects every associated Workspace");
    await click(buttonNamed("Save Shared Name"));

    expect(saved.at(-1)?.projects[0].name).toBe("Carrent Desktop");
    expect(container!.querySelector("h1")?.textContent).toBe("Carrent Desktop");
  });
});
