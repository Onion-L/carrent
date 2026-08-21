export type PermissionRuleDecision = "allow" | "prompt" | "forbidden";
export type PermissionRuleOrigin = "user" | "project" | "built-in";

export type PermissionRuleView = {
  id: string;
  prefix: string[];
  decision: PermissionRuleDecision;
  origin: PermissionRuleOrigin;
  projectDirectory?: string;
  domain?: string;
};
