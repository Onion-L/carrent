import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Maximize2,
  MoreVertical,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SquareCode,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  BrowserClearDataRequest,
  BrowserSearchEngine,
  BrowserThreadState,
  BrowserThreadTarget,
} from "../../../shared/browser";
import { ConfirmDialog } from "../ConfirmDialog";

export function useBrowserThread(target: BrowserThreadTarget | null) {
  const [state, setState] = useState<BrowserThreadState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = window.carrent.browser.onState((next) => {
      if (target && next.threadId === target.threadId) setState(next);
    });
    void window.carrent.browser.activate(target).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      void window.carrent.browser.activate(null);
    };
  }, [target?.projectId, target?.threadId]);

  const open = useCallback(
    async (url?: string) => {
      if (!target) return null;
      const next = await window.carrent.browser.open({ ...target, ...(url ? { url } : {}) });
      setState(next);
      return next;
    },
    [target],
  );

  return { state, setState, open };
}

type BrowserWorkspaceProps = {
  target: BrowserThreadTarget;
  state: BrowserThreadState;
  setState: (state: BrowserThreadState) => void;
  visible: boolean;
  standalone?: boolean;
};

function IconButton({
  label,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition disabled:opacity-30 ${
        active ? "bg-surface-hover text-fg" : "text-muted hover:bg-surface-hover hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function BrowserWorkspace({
  target,
  state,
  setState,
  visible,
  standalone = false,
}: BrowserWorkspaceProps) {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
  const canContinueCertificate = (() => {
    if (!activeTab?.certificateError) return false;
    try {
      const hostname = new URL(activeTab.certificateError.url).hostname;
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    } catch {
      return false;
    }
  })();
  const viewportRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState(activeTab?.url ?? "");
  const [menu, setMenu] = useState<"main" | "data" | "settings" | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [confirmScope, setConfirmScope] = useState<BrowserClearDataRequest["scope"] | null>(null);
  const [hostOverlayOpen, setHostOverlayOpen] = useState(false);
  const nativeVisible =
    visible &&
    !menu &&
    !findOpen &&
    !confirmScope &&
    !hostOverlayOpen &&
    !activeTab?.certificateError;

  useEffect(() => {
    const update = () => {
      const dialog = document.querySelector('[role="dialog"]');
      const terminal = document.querySelector('[data-terminal-maximized="true"]');
      setHostOverlayOpen(Boolean(dialog || terminal));
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => setAddress(activeTab?.url ?? ""), [activeTab?.id, activeTab?.url]);

  useEffect(() => window.carrent.browser.onFocusAddress(() => addressRef.current?.select()), []);
  useEffect(
    () =>
      window.carrent.browser.onFind(() => {
        setFindOpen(true);
        window.setTimeout(() => findRef.current?.focus());
      }),
    [],
  );

  useEffect(() => {
    void window.carrent.browser.setVisible({ ...target, visible: nativeVisible });
    return () => {
      void window.carrent.browser.setVisible({ ...target, visible: false });
    };
  }, [nativeVisible, target.projectId, target.threadId]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const rect = viewport.getBoundingClientRect();
      void window.carrent.browser.setBounds({
        ...target,
        bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [target.projectId, target.threadId]);

  const tabTarget = activeTab ? { ...target, tabId: activeTab.id } : null;
  const run = async (operation: Promise<BrowserThreadState>) => setState(await operation);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const section = sectionRef.current;
      if (!section || !(event.target instanceof Node) || !section.contains(event.target)) return;
      const command = window.carrent.platform === "darwin" ? event.metaKey : event.ctrlKey;
      if (!command || event.altKey || !tabTarget) return;
      const key = event.key.toLowerCase();
      if (key === "l") {
        event.preventDefault();
        addressRef.current?.select();
      } else if (key === "t") {
        event.preventDefault();
        void run(window.carrent.browser.newTab(target));
      } else if (key === "w") {
        event.preventDefault();
        void run(window.carrent.browser.closeTab(tabTarget));
      } else if (key === "r") {
        event.preventDefault();
        void run(window.carrent.browser.action({ ...tabTarget, action: "reload" }));
      } else if (key === "f") {
        event.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findRef.current?.focus());
      } else if (key === "=" || key === "+") {
        event.preventDefault();
        void run(window.carrent.browser.zoom({ ...tabTarget, action: "in" }));
      } else if (key === "-") {
        event.preventDefault();
        void run(window.carrent.browser.zoom({ ...tabTarget, action: "out" }));
      } else if (key === "0") {
        event.preventDefault();
        void run(window.carrent.browser.zoom({ ...tabTarget, action: "reset" }));
      } else if (key === "c" && event.shiftKey && activeTab?.url) {
        event.preventDefault();
        void window.carrent.clipboard.writeText(activeTab.url);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTab?.url, tabTarget?.tabId, target.projectId, target.threadId]);

  const submitAddress = (event: React.FormEvent) => {
    event.preventDefault();
    if (!tabTarget) return;
    void run(window.carrent.browser.navigate({ ...tabTarget, value: address }));
  };

  const closeFind = () => {
    setFindOpen(false);
    if (tabTarget) void window.carrent.browser.stopFind(tabTarget);
  };

  const clearData = async () => {
    if (!confirmScope) return;
    setState(await window.carrent.browser.clearData({ ...target, scope: confirmScope }));
    setConfirmScope(null);
  };

  return (
    <section
      ref={sectionRef}
      className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg"
    >
      <div
        className={`flex h-10 shrink-0 items-center gap-1 border-b border-border bg-sidebar px-2 ${standalone ? "pl-20" : ""}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {state.tabs.map((tab) => (
            <div
              key={tab.id}
              className={`group flex h-8 min-w-[8rem] max-w-[13rem] items-center rounded-md text-app-12 ${
                tab.id === state.activeTabId
                  ? "bg-surface-raised text-fg"
                  : "text-muted hover:bg-surface-hover hover:text-fg"
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  void run(window.carrent.browser.activateTab({ ...target, tabId: tab.id }))
                }
                className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 text-left"
              >
                {tab.loading ? (
                  <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : tab.faviconUrl ? (
                  <img alt="" className="h-3.5 w-3.5 shrink-0" src={tab.faviconUrl} />
                ) : (
                  <Globe2 className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{tab.title || "New Tab"}</span>
              </button>
              <button
                type="button"
                aria-label="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  void run(window.carrent.browser.closeTab({ ...target, tabId: tab.id }));
                }}
                className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface-hover hover:text-fg"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <IconButton label="New tab" onClick={() => void run(window.carrent.browser.newTab(target))}>
          <Plus className="h-4 w-4" />
        </IconButton>
        {standalone ? (
          <IconButton
            label="Dock browser"
            onClick={() => void run(window.carrent.browser.dock(target))}
          >
            <Minus className="h-4 w-4" />
          </IconButton>
        ) : (
          <IconButton
            label="Open in window"
            onClick={() => void run(window.carrent.browser.popOut(target))}
          >
            <Maximize2 className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <div className="relative flex h-11 shrink-0 items-center gap-1 border-b border-border bg-bg px-2">
        <IconButton
          label="Back"
          disabled={!activeTab?.canGoBack}
          onClick={() =>
            tabTarget && void run(window.carrent.browser.action({ ...tabTarget, action: "back" }))
          }
        >
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!activeTab?.canGoForward}
          onClick={() =>
            tabTarget &&
            void run(window.carrent.browser.action({ ...tabTarget, action: "forward" }))
          }
        >
          <ArrowRight className="h-4 w-4" />
        </IconButton>
        <IconButton
          label={activeTab?.loading ? "Stop" : "Reload"}
          onClick={() =>
            tabTarget &&
            void run(
              window.carrent.browser.action({
                ...tabTarget,
                action: activeTab?.loading ? "stop" : "reload",
              }),
            )
          }
        >
          {activeTab?.loading ? <X className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
        </IconButton>
        <form className="min-w-0 flex-1" onSubmit={submitAddress}>
          <input
            ref={addressRef}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="Enter URL or search"
            aria-label="Address"
            className="h-8 w-full rounded-md border border-border bg-surface px-3 text-app-13 text-fg outline-none placeholder:text-subtle focus:border-fg/30"
          />
        </form>
        <IconButton
          label="Browser menu"
          active={menu !== null}
          onClick={() => setMenu(menu ? null : "main")}
        >
          <MoreVertical className="h-4 w-4" />
        </IconButton>

        {menu ? (
          <BrowserMenu
            menu={menu}
            state={state}
            onMenu={setMenu}
            onFind={() => {
              setMenu(null);
              setFindOpen(true);
              window.setTimeout(() => findRef.current?.focus());
            }}
            onZoom={(action) =>
              tabTarget && void run(window.carrent.browser.zoom({ ...tabTarget, action }))
            }
            onCopy={() => {
              if (activeTab?.url) void window.carrent.clipboard.writeText(activeTab.url);
              setMenu(null);
            }}
            onExternal={() => {
              if (tabTarget) void window.carrent.browser.openExternal(tabTarget);
              setMenu(null);
            }}
            onDevTools={() => {
              if (tabTarget)
                void window.carrent.browser.action({ ...tabTarget, action: "devtools" });
              setMenu(null);
            }}
            onClear={(scope) => {
              setMenu(null);
              setConfirmScope(scope);
            }}
            onSearchEngine={(searchEngine) =>
              void run(window.carrent.browser.setSearchEngine({ ...target, searchEngine }))
            }
          />
        ) : null}
      </div>

      {findOpen ? (
        <form
          className="absolute right-3 top-[5.5rem] z-20 flex h-10 w-72 items-center gap-1 rounded-md border border-border bg-surface-raised p-1 shadow-xl"
          onSubmit={(event) => {
            event.preventDefault();
            if (tabTarget) void window.carrent.browser.find({ ...tabTarget, text: findText });
          }}
        >
          <Search className="ml-2 h-3.5 w-3.5 text-subtle" />
          <input
            ref={findRef}
            value={findText}
            onChange={(event) => {
              setFindText(event.target.value);
              if (tabTarget)
                void window.carrent.browser.find({ ...tabTarget, text: event.target.value });
            }}
            className="min-w-0 flex-1 bg-transparent text-app-12 outline-none"
            placeholder="Find in page"
          />
          <IconButton label="Close find" onClick={closeFind}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </form>
      ) : null}

      <div ref={viewportRef} className="relative min-h-0 flex-1 bg-[#111]">
        {!activeTab?.url && !activeTab?.certificateError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted">
            <Globe2 className="h-8 w-8 text-subtle" />
            <span className="text-app-14 font-medium text-fg">Start browsing</span>
          </div>
        ) : null}
        {activeTab?.certificateError ? (
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <div className="max-w-lg text-center">
              <ShieldAlert className="mx-auto h-9 w-9 text-warning" />
              <h2 className="mt-4 text-app-18 font-semibold">Your connection is not private</h2>
              <p className="mt-2 break-all text-app-13 leading-6 text-muted">
                {activeTab.certificateError.url}
              </p>
              {canContinueCertificate ? (
                <button
                  type="button"
                  onClick={() =>
                    tabTarget && void run(window.carrent.browser.continueCertificate(tabTarget))
                  }
                  className="mt-6 h-9 rounded-md border border-border bg-surface px-4 text-app-13 font-medium hover:bg-surface-hover"
                >
                  Continue for this local page
                </button>
              ) : (
                <p className="mt-5 text-app-13 text-muted">
                  Fix the certificate before loading this page.
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {confirmScope ? (
        <ConfirmDialog
          title={
            confirmScope === "all" ? "Clear all browsing data?" : "Clear project browsing data?"
          }
          message="Cookies, cache, site storage, service workers, and permissions will be removed. Affected tabs will reload and signed-in sessions will end."
          confirmLabel="Clear browsing data"
          onCancel={() => setConfirmScope(null)}
          onConfirm={() => void clearData()}
        />
      ) : null}
    </section>
  );
}

function MenuItem({
  icon,
  label,
  trailing,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-3 rounded-md px-2 text-left text-app-13 text-fg hover:bg-surface-hover"
    >
      <span className="flex h-4 w-4 items-center justify-center text-muted">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      {trailing}
    </button>
  );
}

function BrowserMenu({
  menu,
  state,
  onMenu,
  onFind,
  onZoom,
  onCopy,
  onExternal,
  onDevTools,
  onClear,
  onSearchEngine,
}: {
  menu: "main" | "data" | "settings";
  state: BrowserThreadState;
  onMenu: (menu: "main" | "data" | "settings" | null) => void;
  onFind: () => void;
  onZoom: (action: "in" | "out" | "reset") => void;
  onCopy: () => void;
  onExternal: () => void;
  onDevTools: () => void;
  onClear: (scope: "project" | "all") => void;
  onSearchEngine: (engine: BrowserSearchEngine) => void;
}) {
  const active = state.tabs.find((tab) => tab.id === state.activeTabId);
  return (
    <div className="absolute right-2 top-10 z-30 w-72 rounded-md border border-border bg-surface-raised p-1.5 shadow-xl">
      {menu === "main" ? (
        <>
          <MenuItem icon={<Search className="h-4 w-4" />} label="Find in page" onClick={onFind} />
          <div className="my-1 flex h-10 items-center gap-2 border-y border-border px-2">
            <span className="min-w-0 flex-1 text-app-13">Zoom</span>
            <IconButton label="Zoom out" onClick={() => onZoom("out")}>
              <Minus className="h-3.5 w-3.5" />
            </IconButton>
            <button
              type="button"
              onClick={() => onZoom("reset")}
              className="w-12 text-center text-app-12 text-muted hover:text-fg"
            >
              {Math.round((active?.zoomFactor ?? 1) * 100)}%
            </button>
            <IconButton label="Zoom in" onClick={() => onZoom("in")}>
              <Plus className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <MenuItem
            icon={<Copy className="h-4 w-4" />}
            label="Copy current link"
            onClick={onCopy}
          />
          <MenuItem
            icon={<ExternalLink className="h-4 w-4" />}
            label="Open in system browser"
            onClick={onExternal}
          />
          <MenuItem
            icon={<SquareCode className="h-4 w-4" />}
            label="Developer tools"
            onClick={onDevTools}
          />
          <MenuItem
            label="Clear browsing data"
            trailing={<ChevronRight className="h-4 w-4 text-subtle" />}
            onClick={() => onMenu("data")}
          />
          <MenuItem
            label="Browser settings"
            trailing={<ChevronRight className="h-4 w-4 text-subtle" />}
            onClick={() => onMenu("settings")}
          />
        </>
      ) : null}
      {menu === "data" ? (
        <>
          <MenuItem
            icon={<ArrowLeft className="h-4 w-4" />}
            label="Clear browsing data"
            onClick={() => onMenu("main")}
          />
          <div className="my-1 border-t border-border" />
          <MenuItem label="Clear current project data" onClick={() => onClear("project")} />
          <MenuItem label="Clear all browsing data" onClick={() => onClear("all")} />
        </>
      ) : null}
      {menu === "settings" ? (
        <>
          <MenuItem
            icon={<ArrowLeft className="h-4 w-4" />}
            label="Search engine"
            onClick={() => onMenu("main")}
          />
          <div className="my-1 border-t border-border" />
          {(["google", "bing", "duckduckgo"] as const).map((engine) => (
            <MenuItem
              key={engine}
              label={
                engine === "duckduckgo" ? "DuckDuckGo" : engine[0].toUpperCase() + engine.slice(1)
              }
              icon={state.searchEngine === engine ? <Check className="h-4 w-4" /> : undefined}
              onClick={() => onSearchEngine(engine)}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}
