import { Monitor, Palette, Settings, SlidersHorizontal, UserRound } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  buildSettingsPath,
  resolveSettingsTabId,
  SETTINGS_TABS,
  type SettingsTabId,
} from "../../lib/settingsTabs";

const iconByTabId: Record<SettingsTabId, typeof Monitor> = {
  runtime: Monitor,
  personalization: UserRound,
  interface: Palette,
  about: SlidersHorizontal,
};

export function SettingsTabsPane() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const activeTabId = resolveSettingsTabId(searchParams.get("tab"));

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Settings className="h-4 w-4 shrink-0 text-subtle" />
          <h2 className="min-w-0 truncate text-app-13 font-semibold text-fg">Settings</h2>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-auto p-2" aria-label="Settings tabs">
        <div className="space-y-0.5">
          {SETTINGS_TABS.map((tab) => {
            const Icon = iconByTabId[tab.id];
            const isActive = tab.id === activeTabId;

            return (
              <button
                key={tab.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => navigate(buildSettingsPath(tab.id), { state: location.state })}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                  isActive
                    ? "bg-surface-hover text-fg shadow-[inset_0_0_0_1px_rgb(var(--color-border-strong)/0.28)]"
                    : "text-muted hover:bg-surface-raised hover:text-fg"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-subtle" />
                <span className="min-w-0">
                  <span className="block truncate text-app-13 font-medium">{tab.label}</span>
                  <span className="mt-0.5 block truncate text-app-11 text-subtle">
                    {tab.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
