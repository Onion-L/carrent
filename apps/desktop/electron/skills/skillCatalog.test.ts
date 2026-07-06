import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  listInstalledSkills,
  listSkillResources,
  parseSkillFrontMatter,
  readSkill,
  readSkillResource,
} from "./skillCatalog";

async function createTempHome() {
  return mkdtemp(path.join(os.tmpdir(), "carrent-skills-"));
}

async function writeSkill(homeDir: string, relativePath: string, content: string) {
  const targetPath = path.join(homeDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  return targetPath;
}

async function expectRejectsWithMessage(promise: Promise<unknown>, message: string) {
  try {
    await promise;
    throw new Error("Expected promise to reject.");
  } catch (error) {
    expect(error instanceof Error).toBe(true);
    expect((error as Error).message).toContain(message);
  }
}

describe("parseSkillFrontMatter", () => {
  it("reads quoted and unquoted skill metadata", () => {
    expect(
      parseSkillFrontMatter(`---
name: "openai-docs"
description: Use official OpenAI docs.
---

# OpenAI Docs
`),
    ).toEqual({
      name: "openai-docs",
      description: "Use official OpenAI docs.",
    });
  });

  it("ignores files without required metadata", () => {
    expect(parseSkillFrontMatter("# No frontmatter")).toEqual(null);
    expect(parseSkillFrontMatter("---\nname: missing-description\n---")).toEqual(null);
  });
});

describe("listInstalledSkills", () => {
  it("lists skills from agents, codex, and plugin cache roots", async () => {
    const homeDir = await createTempHome();
    try {
      const grillingPath = await writeSkill(
        homeDir,
        ".agents/skills/grilling/SKILL.md",
        `---
name: grilling
description: Interview the user relentlessly.
---
`,
      );
      const docsPath = await writeSkill(
        homeDir,
        ".codex/skills/.system/openai-docs/SKILL.md",
        `---
name: openai-docs
description: Use official OpenAI docs.
---
`,
      );
      const browserPath = await writeSkill(
        homeDir,
        ".codex/plugins/cache/openai-bundled/browser/1/skills/control-in-app-browser/SKILL.md",
        `---
name: browser:control-in-app-browser
description: Control the in-app Browser.
---
`,
      );

      const skills = await listInstalledSkills(homeDir);

      expect(skills).toEqual([
        {
          name: "browser:control-in-app-browser",
          description: "Control the in-app Browser.",
          path: browserPath,
          source: "plugin",
          declaredPath: browserPath,
          realPath: await realpath(browserPath),
          declaredRootPath: path.dirname(browserPath),
          realRootPath: await realpath(path.dirname(browserPath)),
        },
        {
          name: "grilling",
          description: "Interview the user relentlessly.",
          path: grillingPath,
          source: "agents",
          declaredPath: grillingPath,
          realPath: await realpath(grillingPath),
          declaredRootPath: path.dirname(grillingPath),
          realRootPath: await realpath(path.dirname(grillingPath)),
        },
        {
          name: "openai-docs",
          description: "Use official OpenAI docs.",
          path: docsPath,
          source: "codex",
          declaredPath: docsPath,
          realPath: await realpath(docsPath),
          declaredRootPath: path.dirname(docsPath),
          realRootPath: await realpath(path.dirname(docsPath)),
        },
      ]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("does not follow SKILL.md file symlinks outside the skill root", async () => {
    const homeDir = await createTempHome();
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "carrent-skill-file-link-"));
    try {
      const declaredRoot = path.join(homeDir, ".agents/skills/linked-file");
      await mkdir(declaredRoot, { recursive: true });
      const outsideSkill = path.join(outsideDir, "SKILL.md");
      await writeFile(
        outsideSkill,
        `---
name: linked-file
description: Escaped skill file.
---

outside
`,
      );
      await symlink(outsideSkill, path.join(declaredRoot, "SKILL.md"));

      expect(await listInstalledSkills(homeDir)).toEqual([]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("skips unreadable or invalid skill files", async () => {
    const homeDir = await createTempHome();
    try {
      await writeSkill(homeDir, ".agents/skills/invalid/SKILL.md", "# invalid");

      expect(await listInstalledSkills(homeDir)).toEqual([]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reads a skill by name with declared and real path metadata", async () => {
    const homeDir = await createTempHome();
    try {
      const skillPath = await writeSkill(
        homeDir,
        ".agents/skills/grilling/SKILL.md",
        `---
name: grilling
description: Interview the user relentlessly.
---

# Grilling
`,
      );

      const result = await readSkill({ name: "grilling" }, { homeDir });

      expect(result.content).toContain("# Grilling");
      expect(result.skill).toMatchObject({
        name: "grilling",
        path: skillPath,
        declaredPath: skillPath,
        realPath: await realpath(skillPath),
        declaredRootPath: path.dirname(skillPath),
        realRootPath: await realpath(path.dirname(skillPath)),
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("supports symlinked skill roots while enforcing the real root", async () => {
    const homeDir = await createTempHome();
    const actualRoot = await mkdtemp(path.join(os.tmpdir(), "carrent-skill-real-"));
    try {
      await writeFile(
        path.join(actualRoot, "SKILL.md"),
        `---
name: symlinked
description: A symlinked skill.
---
`,
      );
      await writeFile(path.join(actualRoot, "notes.md"), "notes", "utf8");
      const declaredRoot = path.join(homeDir, ".agents/skills/symlinked");
      await mkdir(path.dirname(declaredRoot), { recursive: true });
      await symlink(actualRoot, declaredRoot);

      const skill = await readSkill({ name: "symlinked" }, { homeDir });
      const resources = await listSkillResources({ name: "symlinked" }, { homeDir });
      const resource = await readSkillResource({ name: "symlinked" }, "notes.md", { homeDir });

      expect(skill.skill.declaredRootPath).toBe(declaredRoot);
      expect(skill.skill.realRootPath).toBe(await realpath(actualRoot));
      expect(resources.resources).toEqual([{ path: "notes.md", size: 5 }]);
      expect(resource.content).toBe("notes");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
      await rm(actualRoot, { recursive: true, force: true });
    }
  });

  it("rejects resource paths and symlinks that escape the selected skill root", async () => {
    const homeDir = await createTempHome();
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "carrent-skill-outside-"));
    try {
      await writeSkill(
        homeDir,
        ".agents/skills/safe/SKILL.md",
        `---
name: safe
description: A safe skill.
---
`,
      );
      const skillRoot = path.join(homeDir, ".agents/skills/safe");
      await writeFile(path.join(outsideDir, "secret.md"), "secret", "utf8");
      await symlink(path.join(outsideDir, "secret.md"), path.join(skillRoot, "secret-link.md"));
      await mkdir(path.join(skillRoot, "refs"), { recursive: true });
      await writeFile(path.join(skillRoot, "notes.md"), "notes", "utf8");

      await expectRejectsWithMessage(
        readSkillResource({ name: "safe" }, "../safe/SKILL.md", { homeDir }),
        "outside skill root",
      );
      await expectRejectsWithMessage(
        readSkillResource({ name: "safe" }, "secret-link.md", { homeDir }),
        "outside skill root",
      );
      await expectRejectsWithMessage(
        readSkillResource({ name: "safe" }, "refs/../notes.md", { homeDir }),
        "outside skill root",
      );
    } finally {
      await rm(homeDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("lists only bounded UTF-8 text resources", async () => {
    const homeDir = await createTempHome();
    try {
      await writeSkill(
        homeDir,
        ".agents/skills/text-only/SKILL.md",
        `---
name: text-only
description: Text resources only.
---
`,
      );
      const skillRoot = path.join(homeDir, ".agents/skills/text-only");
      await writeFile(path.join(skillRoot, "notes.md"), "notes", "utf8");
      await writeFile(path.join(skillRoot, "binary.bin"), Buffer.from([0, 1, 2, 3]));
      await writeFile(path.join(skillRoot, "big.md"), "x".repeat(257 * 1024), "utf8");

      expect((await listSkillResources({ name: "text-only" }, { homeDir })).resources).toEqual([
        { path: "notes.md", size: 5 },
      ]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("requires explicit skill lookup instead of cross-skill resource traversal", async () => {
    const homeDir = await createTempHome();
    try {
      await writeSkill(
        homeDir,
        ".agents/skills/one/SKILL.md",
        `---
name: one
description: First skill.
---
`,
      );
      await writeSkill(
        homeDir,
        ".agents/skills/two/SKILL.md",
        `---
name: two
description: Second skill.
---
`,
      );

      await expectRejectsWithMessage(
        readSkillResource({ name: "one" }, "../two/SKILL.md", { homeDir }),
        "outside skill root",
      );
      expect(await readSkill({ name: "two" }, { homeDir })).toMatchObject({
        skill: { name: "two" },
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
