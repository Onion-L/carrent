import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MoreVertical,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  BrowserClearDataRequest,
  BrowserMenuSession,
  BrowserTabTarget,
  BrowserThreadState,
  BrowserThreadTarget,
} from "../../../shared/browser";
import { ConfirmDialog } from "../ConfirmDialog";

export function useBrowserThread(target: BrowserThreadTarget | null) {
  const [state, setState] = useState<BrowserThreadState | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    const unsubscribe = window.carrent.browser.onState((next) => {
      if (target && next.projectId === target.projectId && next.threadId === target.threadId) {
        setState(next);
      }
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
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
};

function IconButton({
  label,
  disabled,
  active,
  buttonRef,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  active?: boolean;
  buttonRef?: React.Ref<HTMLButtonElement>;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
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
  fullscreen = false,
  onToggleFullscreen,
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
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRequestId = useRef(0);
  const addressRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState(activeTab?.url ?? "");
  const [menuSession, setMenuSession] = useState<
    (BrowserMenuSession & { target: BrowserTabTarget }) | null
  >(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [confirmScope, setConfirmScope] = useState<BrowserClearDataRequest["scope"] | null>(null);
  const [hostOverlayOpen, setHostOverlayOpen] = useState(false);
  const nativeVisible =
    visible && !findOpen && !confirmScope && !hostOverlayOpen && !activeTab?.certificateError;

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
    menuRequestId.current += 1;
    setMenuSession(null);
  }, [activeTab?.id, target.projectId, target.threadId]);

  useEffect(
    () =>
      window.carrent.browser.onMenuClosed((event) => {
        setMenuSession((current) => (current?.token === event.token ? null : current));
      }),
    [],
  );

  useEffect(
    () =>
      window.carrent.browser.onMenuAction((event) => {
        if (
          event.projectId !== target.projectId ||
          event.threadId !== target.threadId ||
          event.tabId !== activeTab?.id ||
          event.action.type === "set-mode"
        ) {
          return;
        }
        const action = event.action;
        if (action.type !== "zoom" && action.type !== "set-search-engine") {
          setMenuSession(null);
        }
        if (action.type === "find") {
          setFindOpen(true);
          window.setTimeout(() => findRef.current?.focus());
        } else if (action.type === "zoom") {
          void run(window.carrent.browser.zoom({ ...event, action: action.action }));
        } else if (action.type === "copy-link") {
          if (activeTab.url) void window.carrent.clipboard.writeText(activeTab.url);
        } else if (action.type === "open-external") {
          void window.carrent.browser.openExternal(event);
        } else if (action.type === "devtools") {
          void run(window.carrent.browser.action({ ...event, action: "devtools" }));
        } else if (action.type === "clear-data") {
          setConfirmScope(action.scope);
        } else if (action.type === "set-search-engine") {
          void run(
            window.carrent.browser.setSearchEngine({
              projectId: event.projectId,
              threadId: event.threadId,
              searchEngine: action.searchEngine,
            }),
          );
        }
      }),
    [activeTab?.id, activeTab?.url, target.projectId, target.threadId],
  );

  useEffect(() => {
    return () => {
      if (menuSession) {
        void window.carrent.browser.closeMenu({
          ...menuSession.target,
          token: menuSession.token,
        });
      }
    };
  }, [menuSession]);

  useLayoutEffect(() => {
    if (!menuSession) return;
    const button = menuButtonRef.current;
    const section = sectionRef.current;
    if (!button || !section) return;
    const update = () => {
      const rect = button.getBoundingClientRect();
      void window.carrent.browser.updateMenu({
        ...menuSession.target,
        token: menuSession.token,
        anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(button);
    observer.observe(section);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [menuSession]);

  useEffect(() => {
    if (!menuSession) return;
    const closeOnHostPointer = (event: PointerEvent) => {
      const button = menuButtonRef.current;
      if (button && event.target instanceof Node && button.contains(event.target)) return;
      setMenuSession(null);
    };
    document.addEventListener("pointerdown", closeOnHostPointer, true);
    return () => document.removeEventListener("pointerdown", closeOnHostPointer, true);
  }, [menuSession]);

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

  const toggleMenu = async () => {
    const requestId = ++menuRequestId.current;
    if (menuSession) {
      setMenuSession(null);
      void window.carrent.browser.closeMenu({
        ...menuSession.target,
        token: menuSession.token,
      });
      return;
    }
    const button = menuButtonRef.current;
    if (!tabTarget || !button) return;
    const rect = button.getBoundingClientRect();
    const requestTarget = tabTarget;
    const session = await window.carrent.browser.openMenu({
      ...requestTarget,
      anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
    });
    if (menuRequestId.current !== requestId) {
      void window.carrent.browser.closeMenu({ ...requestTarget, token: session.token });
      return;
    }
    setMenuSession({ ...session, target: requestTarget });
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
            label={fullscreen ? "Exit browser fullscreen" : "Enter browser fullscreen"}
            onClick={() => onToggleFullscreen?.()}
          >
            {fullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
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
          active={menuSession !== null}
          buttonRef={menuButtonRef}
          onClick={() => void toggleMenu()}
        >
          <MoreVertical className="h-4 w-4" />
        </IconButton>
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
