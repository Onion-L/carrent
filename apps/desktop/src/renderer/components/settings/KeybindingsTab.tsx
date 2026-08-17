import { ACTION_IDS, type ActionId } from "../../../shared/keybindings";
import { useSettings } from "../../context/SettingsContext";
import { formatKeybinding, resolveKeybinding } from "../../lib/keybindings";

const ACTION_LABELS: Record<ActionId, string> = {
  "search-threads": "Search Threads",
  "toggle-terminal": "Toggle Terminal",
  "zoom-in": "Zoom In",
  "zoom-out": "Zoom Out",
  "reset-zoom": "Reset Zoom",
};

export function KeybindingsTab() {
  const { keybindingOverrides } = useSettings();

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full table-fixed border-collapse text-left">
        <thead className="bg-surface-raised text-app-11 font-medium text-subtle">
          <tr className="border-b border-border">
            <th className="w-1/2 px-4 py-2.5 font-medium">Action</th>
            <th className="px-4 py-2.5 font-medium">Shortcut</th>
            <th className="w-12 px-2 py-2.5 font-medium">
              <span className="sr-only">Reset</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ACTION_IDS.map((actionId) => {
            const binding = resolveKeybinding(actionId, keybindingOverrides);

            return (
              <tr key={actionId}>
                <td className="px-4 py-3 text-app-13 text-fg">{ACTION_LABELS[actionId]}</td>
                <td className="px-4 py-3">
                  {binding ? (
                    <kbd className="inline-flex min-h-7 items-center rounded-md border border-border-strong bg-surface px-2.5 font-mono text-app-12 text-fg shadow-[0_1px_0_rgb(var(--color-border-strong)/0.35)]">
                      {formatKeybinding(binding)}
                    </kbd>
                  ) : (
                    <span className="text-app-12 text-subtle">Unassigned</span>
                  )}
                </td>
                <td className="w-12 px-2 py-3" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
