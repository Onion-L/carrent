import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deleteKimiMemoryFile,
  listKimiMemory,
  parseFrontmatter,
  projectDisplayName,
} from "./kimiMemory";

let kimiCodeDir: string;

const PROJECT_KEY = "-Users-onion-workbench-carrent-17e396ae3d2e";

async function writeMemoryFile(
  projectKey: string,
  fileName: string,
  content: string,
): Promise<string> {
  const dir = path.join(kimiCodeDir, "projects", projectKey, "memory");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

beforeEach(async () => {
  kimiCodeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-memory-test-"));
});

afterEach(async () => {
  await fs.rm(kimiCodeDir, { recursive: true, force: true });
});

describe("parseFrontmatter", () => {
  it("parses key-value lines between --- fences", () => {
    const { frontmatter, body } = parseFrontmatter(
      "---\nname: user-role\ndescription: I am an engineer\ntype: user\n---\nbody text\n",
    );

    expect(frontmatter).toEqual({
      name: "user-role",
      description: "I am an engineer",
      type: "user",
    });
    expect(body).toBe("body text\n");
  });

  it("returns the whole content as body when there is no frontmatter", () => {
    const { frontmatter, body } = parseFrontmatter("just markdown\n");

    expect(frontmatter).toEqual({});
    expect(body).toBe("just markdown\n");
  });

  it("treats an unterminated fence as no frontmatter", () => {
    const { frontmatter, body } = parseFrontmatter("---\nname: x\nbody without closing fence\n");

    expect(frontmatter).toEqual({});
    expect(body).toBe("---\nname: x\nbody without closing fence\n");
  });

  it("keeps colons inside values", () => {
    const { frontmatter } = parseFrontmatter("---\ndescription: run at 10:30 daily\n---\nbody\n");

    expect(frontmatter.description).toBe("run at 10:30 daily");
  });
});

describe("projectDisplayName", () => {
  it("strips the trailing 12-char hex hash and keeps the last segment", () => {
    expect(projectDisplayName(PROJECT_KEY)).toBe("carrent");
  });

  it("falls back to the key when nothing is left", () => {
    expect(projectDisplayName("-17e396ae3d2e")).toBe("-17e396ae3d2e");
  });
});

describe("listKimiMemory", () => {
  it("returns an empty index when kimi-code has no projects directory", async () => {
    const index = await listKimiMemory({ kimiCodeDir });

    expect(index.projects).toEqual([]);
    expect(typeof index.scannedAt).toBe("string");
  });

  it("groups memory files by project and parses frontmatter", async () => {
    await writeMemoryFile(
      PROJECT_KEY,
      "MEMORY.md",
      "# Memory Index\n\n- [User role](user-role.md)\n",
    );
    await writeMemoryFile(
      PROJECT_KEY,
      "user-role.md",
      "---\nname: user-role\ndescription: Who the user is\ntype: user\n---\nStaff engineer.\n",
    );
    await writeMemoryFile(
      "-Users-onion-workbench-landing-abcdef012345",
      "stack.md",
      "---\nname: stack\ndescription: Astro site\ntype: project\n---\nUses Astro.\n",
    );

    const index = await listKimiMemory({ kimiCodeDir });

    expect(index.projects.map((project) => project.name)).toEqual(["carrent", "landing"]);
    const carrent = index.projects[0]!;
    expect(carrent.key).toBe(PROJECT_KEY);
    // MEMORY.md (isIndex) sorts first.
    expect(carrent.files.map((file) => file.fileName)).toEqual(["MEMORY.md", "user-role.md"]);
    expect(carrent.files[0]?.isIndex).toBe(true);

    const userRole = carrent.files[1]!;
    expect(userRole.name).toBe("user-role");
    expect(userRole.description).toBe("Who the user is");
    expect(userRole.type).toBe("user");
    expect(userRole.body).toBe("Staff engineer.\n");
    expect(userRole.isIndex).toBe(false);
    expect(typeof userRole.modifiedAt).toBe("number");
    expect(userRole.path).toBe(
      path.join(kimiCodeDir, "projects", PROJECT_KEY, "memory", "user-role.md"),
    );
  });

  it("falls back to the file name and type=other without frontmatter", async () => {
    await writeMemoryFile(PROJECT_KEY, "notes.md", "no frontmatter here\n");

    const index = await listKimiMemory({ kimiCodeDir });
    const file = index.projects[0]?.files[0];

    expect(file?.name).toBe("notes");
    expect(file?.description).toBe("");
    expect(file?.type).toBe("other");
    expect(file?.body).toBe("no frontmatter here\n");
  });

  it("maps unknown frontmatter types to other", async () => {
    await writeMemoryFile(PROJECT_KEY, "odd.md", "---\nname: odd\ntype: weird\n---\nbody\n");

    const index = await listKimiMemory({ kimiCodeDir });

    expect(index.projects[0]?.files[0]?.type).toBe("other");
  });

  it("skips projects without a memory directory and non-markdown files", async () => {
    await fs.mkdir(path.join(kimiCodeDir, "projects", "no-memory-project"), { recursive: true });
    await writeMemoryFile(PROJECT_KEY, "keep.md", "body\n");
    await writeMemoryFile(PROJECT_KEY, "ignore.txt", "not markdown\n");

    const index = await listKimiMemory({ kimiCodeDir });

    expect(index.projects).toHaveLength(1);
    expect(index.projects[0]?.files.map((file) => file.fileName)).toEqual(["keep.md"]);
  });

  it("resolves the kimi home from an injected homeDir when KIMI_CODE_HOME is unset", async () => {
    const saved = process.env.KIMI_CODE_HOME;
    delete process.env.KIMI_CODE_HOME;
    try {
      const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kimi-memory-home-"));
      try {
        kimiCodeDir = path.join(homeDir, ".kimi-code");
        await writeMemoryFile(PROJECT_KEY, "a.md", "body\n");

        const index = await listKimiMemory({ homeDir });

        expect(index.projects[0]?.name).toBe("carrent");
      } finally {
        await fs.rm(homeDir, { recursive: true, force: true });
      }
    } finally {
      if (saved !== undefined) process.env.KIMI_CODE_HOME = saved;
    }
  });
});

describe("deleteKimiMemoryFile", () => {
  it("deletes a file inside a project memory directory", async () => {
    const filePath = await writeMemoryFile(PROJECT_KEY, "stale.md", "old\n");

    await deleteKimiMemoryFile(filePath, { kimiCodeDir });

    try {
      await fs.stat(filePath);
      expect(false).toBe(true);
    } catch {
      // File is gone.
    }
    const index = await listKimiMemory({ kimiCodeDir });
    expect(index.projects).toEqual([]);
  });

  it("rejects paths outside the memory directories", async () => {
    const outside = path.join(kimiCodeDir, "projects", PROJECT_KEY, "settings.json");
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.writeFile(outside, "{}", "utf8");

    try {
      await deleteKimiMemoryFile(outside, { kimiCodeDir });
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toContain("outside the Kimi Code memory directories");
    }
    expect(await fs.readFile(outside, "utf8")).toBe("{}");
  });

  it("rejects traversal that escapes the memory directory", async () => {
    const victim = path.join(kimiCodeDir, "projects", PROJECT_KEY, "secret.md");
    await fs.mkdir(path.dirname(victim), { recursive: true });
    await fs.writeFile(victim, "keep me\n", "utf8");

    const traversal = path.join(kimiCodeDir, "projects", PROJECT_KEY, "memory", "..", "secret.md");
    try {
      await deleteKimiMemoryFile(traversal, { kimiCodeDir });
      expect(false).toBe(true);
    } catch (error) {
      expect((error as Error).message).toContain("outside the Kimi Code memory directories");
    }
    expect(await fs.readFile(victim, "utf8")).toBe("keep me\n");
  });
});
