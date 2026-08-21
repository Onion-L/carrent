import { useEffect, useState } from "react";
import type { PermissionRuleView } from "../../../shared/permissionRules";

export function PermissionRulesPanel() {
  const [rules, setRules] = useState<PermissionRuleView[]>([]);
  const [prefix, setPrefix] = useState("");
  const [decision, setDecision] = useState<"allow" | "prompt" | "forbidden">("allow");
  const [error, setError] = useState("");
  const load = () =>
    window.carrent.settings.permissionRules
      .list()
      .then(setRules)
      .catch(() => setError("Unable to load permission rules."));
  useEffect(() => {
    void load();
  }, []);
  const revoke = async (id: string) => {
    try {
      await window.carrent.settings.permissionRules.revoke(id);
      await load();
    } catch {
      setError("Unable to revoke this rule.");
    }
  };
  const add = async () => {
    const parts = prefix.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return;
    try {
      await window.carrent.settings.permissionRules.add({ prefix: parts, decision });
      setPrefix("");
      await load();
    } catch {
      setError("Unable to add this rule.");
    }
  };
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h2 className="text-app-15 font-semibold text-fg">Saved permission rules</h2>
        <p className="mt-1 text-app-12 text-subtle">
          User rules persist across runs. Project rules can only make access stricter.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
          placeholder="Command prefix, e.g. git status"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-app-13 text-fg"
        />
        <select
          value={decision}
          onChange={(event) => setDecision(event.target.value as typeof decision)}
          className="rounded-md border border-border bg-surface px-2 text-app-13 text-fg"
        >
          <option value="allow">Allow</option>
          <option value="prompt">Prompt</option>
          <option value="forbidden">Forbidden</option>
        </select>
        <button
          type="button"
          onClick={() => void add()}
          className="rounded-md border border-border-strong px-3 py-2 text-app-13 text-fg"
        >
          Add rule
        </button>
      </div>
      {error ? <p className="text-app-12 text-danger">{error}</p> : null}
      <div className="divide-y divide-border rounded-md border border-border">
        {rules.map((rule) => (
          <div key={rule.id} className="flex items-center gap-3 px-3 py-2.5">
            <code className="min-w-0 flex-1 truncate text-app-12 text-fg">
              {rule.domain ? `host:${rule.domain}` : rule.prefix.join(" ")}
            </code>
            <span className="text-app-11 text-subtle">
              {rule.origin} · {rule.decision}
            </span>
            {rule.origin === "user" ? (
              <button
                type="button"
                onClick={() => void revoke(rule.id)}
                className="text-app-12 text-danger"
              >
                Revoke
              </button>
            ) : null}
          </div>
        ))}
        {rules.length === 0 ? (
          <p className="px-3 py-4 text-app-12 text-subtle">No saved rules.</p>
        ) : null}
      </div>
    </div>
  );
}
