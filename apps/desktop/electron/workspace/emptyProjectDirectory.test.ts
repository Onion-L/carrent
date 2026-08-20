import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createEmptyProjectDirectoryManager,
  getDefaultNewProjectBaseDirectory,
  registerEmptyProjectDirectoryIpc,
} from "./emptyProjectDirectory";

let root: string;

beforeEach(async () => {
  // realpath: on macOS the temp dir lives behind the /var -> /private/var
  // symlink, and the manager returns canonicalized paths.
  root = await realpath(await mkdtemp(join(tmpdir(), "carrent-empty-project-test-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function catchError(operation: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return String(error);
  }
  throw new Error("Expected the operation to throw.");
}

const createManager = (settings: { newProjectLocation?: string } | null = null) =>
  createEmptyProjectDirectoryManager({
    homeDirectory: root,
    loadSettings: async () => settings,
  });

describe("getDefaultNewProjectBaseDirectory", () => {
  it("is a CarrentProjects directory inside the OS user directory", () => {
    expect(getDefaultNewProjectBaseDirectory("/home/user")).toBe(
      join("/home/user", "CarrentProjects"),
    );
  });
});

describe("createEmptyProjectDirectoryManager.create", () => {
  it("lazily creates the default base and the empty Project directory inside it", async () => {
    const manager = createManager();
    const result = await manager.create({ name: "My Project" });

    const base = join(root, "CarrentProjects");
    expect(result.workingDirectory).toBe(join(base, "My Project"));
    expect((await stat(result.workingDirectory)).isDirectory()).toBe(true);
    expect(await readdir(result.workingDirectory)).toEqual([]);
  });

  it("preserves the trimmed name without rewriting it", async () => {
    const manager = createManager();
    const result = await manager.create({ name: "  我的 项目  " });
    expect(result.workingDirectory).toBe(join(root, "CarrentProjects", "我的 项目"));
  });

  it("uses the custom New Project location from settings", async () => {
    const customBase = join(root, "custom-base");
    await mkdir(customBase);
    const manager = createManager({ newProjectLocation: customBase });

    const result = await manager.create({ name: "demo" });
    expect(result.workingDirectory).toBe(join(customBase, "demo"));
  });

  it("prefers an explicit per-creation base over the settings location", async () => {
    const customBase = join(root, "custom-base");
    const overrideBase = join(root, "override-base");
    await mkdir(customBase);
    await mkdir(overrideBase);
    const manager = createManager({ newProjectLocation: customBase });

    const result = await manager.create({ name: "demo", baseDirectory: overrideBase });
    expect(result.workingDirectory).toBe(join(overrideBase, "demo"));
  });

  it("rejects an invalid name without touching the filesystem", async () => {
    const manager = createManager();
    expect(await catchError(() => manager.create({ name: "a/b" }))).toContain("cannot contain");
    expect(await catchError(() => stat(join(root, "CarrentProjects")))).toContain("ENOENT");
  });

  it("rejects creation when the target path already exists", async () => {
    const manager = createManager();
    await manager.create({ name: "demo" });

    expect(await catchError(() => manager.create({ name: "demo" }))).toContain("already exists");
    // Also when a non-directory file occupies the path.
    await writeFile(join(root, "CarrentProjects", "taken"), "content");
    expect(await catchError(() => manager.create({ name: "taken" }))).toContain("already exists");
  });

  it("fails instead of falling back when the custom location is missing", async () => {
    const manager = createManager({ newProjectLocation: join(root, "gone") });
    expect(await catchError(() => manager.create({ name: "demo" }))).toContain("unavailable");
  });

  it("reports a clear error when the custom location is not writable", async () => {
    const readOnlyBase = join(root, "read-only");
    await mkdir(readOnlyBase);
    await chmod(readOnlyBase, 0o555);
    const manager = createManager({ newProjectLocation: readOnlyBase });

    expect(await catchError(() => manager.create({ name: "demo" }))).toContain("not writable");
  });
});

describe("createEmptyProjectDirectoryManager.removeIfEmpty", () => {
  it("removes a directory that is still empty", async () => {
    const manager = createManager();
    const { workingDirectory } = await manager.create({ name: "demo" });

    expect(await manager.removeIfEmpty(workingDirectory)).toEqual({ removed: true });
    expect(await catchError(() => stat(workingDirectory))).toContain("ENOENT");
  });

  it("keeps a directory that gained content", async () => {
    const manager = createManager();
    const { workingDirectory } = await manager.create({ name: "demo" });
    await writeFile(join(workingDirectory, "notes.txt"), "content");

    expect(await manager.removeIfEmpty(workingDirectory)).toEqual({ removed: false });
    expect((await stat(workingDirectory)).isDirectory()).toBe(true);
  });

  it("ignores a directory that is already gone", async () => {
    const manager = createManager();
    expect(await manager.removeIfEmpty(join(root, "missing"))).toEqual({ removed: false });
  });

  it("refuses to remove a directory the manager did not create, even if empty", async () => {
    const foreign = join(root, "foreign");
    await mkdir(foreign);
    const manager = createManager();

    expect(await manager.removeIfEmpty(foreign)).toEqual({ removed: false });
    expect((await stat(foreign)).isDirectory()).toBe(true);
  });
});

describe("registerEmptyProjectDirectoryIpc", () => {
  const register = (manager: ReturnType<typeof createManager>) => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    registerEmptyProjectDirectoryIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      manager,
    );
    return handlers;
  };

  it("exposes the default base directory", async () => {
    const handlers = register(createManager());
    expect(await handlers.get("project-directory:default-base")?.(null)).toEqual({
      baseDirectory: join(root, "CarrentProjects"),
    });
  });

  it("creates an empty Project directory from a valid request", async () => {
    const handlers = register(createManager());
    const result = (await handlers.get("project-directory:create-empty")?.(null, {
      name: "demo",
    })) as { workingDirectory: string };
    expect(result.workingDirectory).toBe(join(root, "CarrentProjects", "demo"));
  });

  it("rejects malformed requests", async () => {
    const handlers = register(createManager());
    expect(
      await catchError(() => handlers.get("project-directory:create-empty")?.(null, null)),
    ).toContain("Invalid");
    expect(
      await catchError(() => handlers.get("project-directory:create-empty")?.(null, { name: 42 })),
    ).toContain("Invalid");
    expect(
      await catchError(() => handlers.get("project-directory:remove-empty")?.(null, "")),
    ).toContain("Invalid");
  });
});
