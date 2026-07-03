import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { listInstalledSkills, parseSkillFrontMatter } from "./skillCatalog";

async function createTempHome() {
  return mkdtemp(path.join(os.tmpdir(), "carrent-skills-"));
}

async function writeSkill(homeDir: string, relativePath: string, content: string) {
  const targetPath = path.join(homeDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  return targetPath;
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
        },
        {
          name: "grilling",
          description: "Interview the user relentlessly.",
          path: grillingPath,
          source: "agents",
        },
        {
          name: "openai-docs",
          description: "Use official OpenAI docs.",
          path: docsPath,
          source: "codex",
        },
      ]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
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
});
