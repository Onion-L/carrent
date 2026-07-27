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

function installBridge(appState: AppStateSnapshot | null, saved: AppStateSnapshot[]) {
  window.carrent = {
    appState: {
      load: async () => appState,
      save: async (snapshot: AppStateSnapshot) => {
        saved.push(structuredClone(snapshot));
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

async function renderApp(appState: AppStateSnapshot | null, initialEntry = "/") {
  const saved: AppStateSnapshot[] = [];
  installBridge(appState, saved);
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
