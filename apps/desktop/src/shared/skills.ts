export type SkillSource = "agents" | "codex";
export type SkillScope = "project" | "user";

export interface SkillRecord {
  name: string;
  description: string;
  path: string;
  source: SkillSource;
  scope?: SkillScope;
  declaredPath?: string;
  realPath?: string;
  declaredRootPath?: string;
  realRootPath?: string;
}
