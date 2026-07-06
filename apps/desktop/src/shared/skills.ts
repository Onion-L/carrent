export type SkillSource = "agents" | "codex" | "plugin";

export interface SkillRecord {
  name: string;
  description: string;
  path: string;
  source: SkillSource;
  declaredPath?: string;
  realPath?: string;
  declaredRootPath?: string;
  realRootPath?: string;
}
