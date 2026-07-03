export type SkillSource = "agents" | "codex" | "plugin";

export interface SkillRecord {
  name: string;
  description: string;
  path: string;
  source: SkillSource;
}
