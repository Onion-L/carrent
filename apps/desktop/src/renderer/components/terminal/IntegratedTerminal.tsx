import "@xterm/xterm/css/xterm.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";

import type { AppProjectRecord } from "../../../shared/workspacePersistence";
import {
  MAX_TERMINAL_PANEL_HEIGHT,
  MIN_TERMINAL_PANEL_HEIGHT,
  type TerminalCandidate,
  type TerminalEvent,
  type TerminalTab,
} from "../../../shared/terminal";
import { useSettings } from "../../context/SettingsContext";

type TerminalController = {
  terminal: Terminal;
  fit: () => void;
  search: SearchAddon;
  writtenOutputLength: number;
  replayPending: boolean;
};

type ContextMenuState = { x: number; y: number; terminalId: string } | null;
type CompletionState = Extract<TerminalEvent, { type: "completion" }>;
const MAX_VISIBLE_CANDIDATES = 12;

function TerminalViewport({
  tab,
  visible,
  register,
  onCreateTab,
  onCloseTab,
  onSearch,
  completion,
  onDismissCompletion,
  onMoveCandidate,
  onAcceptCandidate,
  onAcceptPrediction,
  onFocusChange,
}: {
  tab: TerminalTab;
  visible: boolean;
  register: (terminalId: string, controller: TerminalController) => VoidFunction;
  onCreateTab: () => void;
  onCloseTab: () => void;
  onSearch: () => void;
  completion: CompletionState | null;
  onDismissCompletion: () => void;
  onMoveCandidate: (direction: 1 | -1) => void;
  onAcceptCandidate: () => void;
  onAcceptPrediction: (amount: "all" | "word") => void;
  onFocusChange: (tab: TerminalTab, focused: boolean, columns: number, rows: number) => number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlersRef = useRef({
    onCreateTab,
    onCloseTab,
    onSearch,
    completion,
    onDismissCompletion,
    onMoveCandidate,
    onAcceptCandidate,
    onAcceptPrediction,
  });
  handlersRef.current = {
    onCreateTab,
    onCloseTab,
    onSearch,
    completion,
    onDismissCompletion,
    onMoveCandidate,
    onAcceptCandidate,
    onAcceptPrediction,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        '"SFMono-Regular", "IBM Plex Mono", Consolas, "MesloLGS NF", "JetBrainsMono Nerd Font", "Symbols Nerd Font", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 10_000,
      theme: {
        background: "#151514",
        foreground: "#e7e6e0",
        cursor: "#e7e6e0",
        selectionBackground: "#5a655f88",
        black: "#181817",
        red: "#d36c6c",
        green: "#71b58a",
        yellow: "#d5ad68",
        blue: "#78a6d5",
        magenta: "#b58ac8",
        cyan: "#76b8b1",
        white: "#d8d7d1",
        brightBlack: "#77766f",
        brightRed: "#e58a8a",
        brightGreen: "#91c8a2",
        brightYellow: "#e4c384",
        brightBlue: "#97bae0",
        brightMagenta: "#c8a5d7",
        brightCyan: "#91cbc5",
        brightWhite: "#f2f1ec",
      },
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!(event as MouseEvent).metaKey) return;
        void window.carrent.shell.openExternal(uri);
      }),
    );
    terminal.open(container);
    const controller = {
      terminal,
      search,
      writtenOutputLength: 0,
      replayPending: true,
      fit: () => {
        if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit();
      },
    };
    const unregister = register(tab.id, controller);

    const dataDisposable = terminal.onData((data) => {
      void window.carrent.terminal.write({
        projectId: tab.projectId,
        terminalId: tab.id,
        data,
      });
    });
    const focusVersionRef = { current: 0 };
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void window.carrent.terminal.resize({
        projectId: tab.projectId,
        terminalId: tab.id,
        columns: cols,
        rows,
        focusVersion: focusVersionRef.current,
      });
    });
    const textarea = container.querySelector<HTMLElement>(".xterm-helper-textarea");
    let focused = false;
    const handleFocus = () => {
      if (focused) return;
      focused = true;
      focusVersionRef.current = onFocusChange(tab, true, terminal.cols, terminal.rows);
    };
    const handleBlur = () => {
      if (!focused) return;
      focused = false;
      focusVersionRef.current = onFocusChange(tab, false, terminal.cols, terminal.rows);
    };
    textarea?.addEventListener("focus", handleFocus);
    textarea?.addEventListener("blur", handleBlur);
    const handleWindowFocus = () => {
      if (document.activeElement === textarea) handleFocus();
    };
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleBlur);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const handlers = handlersRef.current;
      if (event.metaKey) {
        switch (event.key.toLocaleLowerCase()) {
          case "t":
            handlers.onCreateTab();
            return false;
          case "w":
            handlers.onCloseTab();
            return false;
          case "f":
            handlers.onSearch();
            return false;
          case "c":
            if (terminal.hasSelection()) {
              void window.carrent.clipboard.writeText(terminal.getSelection());
            }
            return false;
          case "v":
            void window.carrent.clipboard.readText().then((text) => terminal.paste(text));
            return false;
          default:
            return true;
        }
      }
      if (event.key === "Tab") return true;
      if (handlers.completion?.predictionSuffix) {
        if (event.key === "End" || (event.key === "ArrowRight" && !event.altKey)) {
          handlers.onAcceptPrediction("all");
          return false;
        }
        if (event.key === "ArrowRight" && event.altKey) {
          handlers.onAcceptPrediction("word");
          return false;
        }
      }
      if (handlers.completion?.candidates.length) {
        if (event.key === "ArrowDown") {
          handlers.onMoveCandidate(1);
          return false;
        }
        if (event.key === "ArrowUp") {
          handlers.onMoveCandidate(-1);
          return false;
        }
        if (event.key === "Enter") {
          handlers.onAcceptCandidate();
          return false;
        }
      }
      if (event.key === "Escape" && handlers.completion) {
        handlers.onDismissCompletion();
        return false;
      }
      return true;
    });
    const observer = new ResizeObserver(() => controller.fit());
    observer.observe(container);

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      textarea?.removeEventListener("focus", handleFocus);
      textarea?.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleBlur);
      unregister();
      terminal.dispose();
    };
  }, [onFocusChange, register, tab.id, tab.projectId]);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => {
      containerRef.current?.querySelector<HTMLElement>(".xterm-helper-textarea")?.focus();
    });
    return () => window.clearTimeout(timer);
  }, [visible]);

  return <div ref={containerRef} className="h-full min-h-0 w-full" aria-label={tab.title} />;
}

export function IntegratedTerminal({
  project,
  isOpen,
  onOpenChange,
}: {
  project: AppProjectRecord | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { enhancedTerminalCompletion, terminalPanelHeight, updateSetting } = useSettings();
  const [panelHeight, setPanelHeight] = useState(terminalPanelHeight);
  const [tabsByProject, setTabsByProject] = useState<Record<string, TerminalTab[]>>({});
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [completionByTerminal, setCompletionByTerminal] = useState<
    Record<string, CompletionState | undefined>
  >({});
  const [candidateIndex, setCandidateIndex] = useState(0);
  const controllers = useRef(new Map<string, TerminalController>());
  const retainedOutput = useRef(new Map<string, string>());
  const resizingRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const focusVersionRef = useRef(0);
  const syncByProject = useRef(
    new Map<string, { ready: boolean; revision: number; buffered: TerminalEvent[] }>(),
  );
  const applyEventRef = useRef<(event: TerminalEvent) => void>(() => {});
  const [subscribedProjectId, setSubscribedProjectId] = useState<string | null>(null);

  const tabs = project ? (tabsByProject[project.id] ?? []) : [];
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
  const activeCompletion = activeTab ? (completionByTerminal[activeTab.id] ?? null) : null;

  const updateTabs = useCallback(
    (projectId: string, update: (tabs: TerminalTab[]) => TerminalTab[]) => {
      setTabsByProject((current) => ({
        ...current,
        [projectId]: update(current[projectId] ?? []),
      }));
    },
    [],
  );

  const register = useCallback((terminalId: string, controller: TerminalController) => {
    controllers.current.set(terminalId, controller);
    window.setTimeout(() => {
      if (controllers.current.get(terminalId) !== controller) return;
      const output = retainedOutput.current.get(terminalId) ?? "";
      if (output) {
        controller.terminal.write(output, () => {
          controller.terminal.refresh(0, controller.terminal.rows - 1);
        });
      }
      controller.writtenOutputLength = output.length;
      controller.replayPending = false;
    });
    controller.fit();
    return () => {
      if (controllers.current.get(terminalId) === controller) {
        controllers.current.delete(terminalId);
      }
    };
  }, []);

  const createTab = useCallback(
    async (ensureFirst = false) => {
      if (!project || loadingProjectId === project.id) return;
      setLoadingProjectId(project.id);
      try {
        const tab = await window.carrent.terminal.create({
          projectId: project.id,
          projectName: project.name,
          workingDirectory: project.workingDirectory,
          enhancedCompletion: enhancedTerminalCompletion,
          ensureFirst,
        });
        window.setTimeout(() => controllers.current.get(tab.id)?.terminal.focus());
      } finally {
        setLoadingProjectId(null);
      }
    },
    [enhancedTerminalCompletion, loadingProjectId, project, updateTabs],
  );
  const createTabRef = useRef(createTab);
  createTabRef.current = createTab;

  const closeTab = useCallback(
    async (tab: TerminalTab | null = activeTab) => {
      if (!project || !tab) return;
      await window.carrent.terminal.close({ projectId: project.id, terminalId: tab.id });
      if (tabs.length === 1) onOpenChange(false);
    },
    [activeTab, onOpenChange, project, tabs.length, updateTabs],
  );

  const activateTab = useCallback(
    async (tab: TerminalTab) => {
      if (!project) return;
      await window.carrent.terminal.activate({ projectId: project.id, terminalId: tab.id });
      window.setTimeout(() => {
        const controller = controllers.current.get(tab.id);
        controller?.fit();
        controller?.terminal.focus();
      });
    },
    [project],
  );

  const onFocusChange = useCallback(
    (tab: TerminalTab, focused: boolean, columns: number, rows: number) => {
      const focusVersion = ++focusVersionRef.current;
      void window.carrent.terminal.focus({
        projectId: tab.projectId,
        terminalId: tab.id,
        focused,
        columns,
        rows,
        focusVersion,
      });
      return focusVersion;
    },
    [],
  );

  applyEventRef.current = (event: TerminalEvent) => {
    if (event.type === "state") {
      setTabsByProject((current) => ({ ...current, [event.projectId]: event.tabs }));
      if (event.tabs.length === 0) onOpenChange(false);
      return;
    }
    if (event.type === "output") {
      const output = `${retainedOutput.current.get(event.terminalId) ?? ""}${event.data}`;
      retainedOutput.current.set(event.terminalId, output);
      const controller = controllers.current.get(event.terminalId);
      if (controller && !controller.replayPending) {
        controller.terminal.write(event.data);
        controller.writtenOutputLength += event.data.length;
      }
      return;
    }
    if (event.type === "completion") {
      setCompletionByTerminal((current) => ({ ...current, [event.terminalId]: event }));
      setCandidateIndex(0);
      return;
    }
    updateTabs(event.projectId, (current) =>
      current.map((tab) => {
        if (tab.id !== event.terminalId) return tab;
        return event.type === "title"
          ? { ...tab, title: event.title }
          : { ...tab, status: "exited" };
      }),
    );
  };

  useEffect(() => {
    return window.carrent.terminal.onEvent((event: TerminalEvent) => {
      const sync = syncByProject.current.get(event.projectId);
      if (!sync) return;
      if (!sync.ready) {
        sync.buffered.push(event);
        return;
      }
      if (event.revision <= sync.revision) return;
      sync.revision = event.revision;
      applyEventRef.current(event);
    });
  }, []);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    const projectId = project.id;
    const sync = { ready: false, revision: -1, buffered: [] as TerminalEvent[] };
    syncByProject.current.set(projectId, sync);
    setSubscribedProjectId(null);
    setSearchOpen(false);
    void window.carrent.terminal.subscribe(projectId).then((snapshot) => {
      if (cancelled) return;
      sync.revision = snapshot.revision;
      setTabsByProject((current) => ({ ...current, [projectId]: snapshot.tabs }));
      for (const tab of snapshot.tabs) {
        const output = snapshot.outputByTerminal[tab.id] ?? "";
        retainedOutput.current.set(tab.id, output);
        const controller = controllers.current.get(tab.id);
        if (
          !controller ||
          controller.replayPending ||
          output.length <= controller.writtenOutputLength
        ) {
          continue;
        }
        const missing = output.slice(controller.writtenOutputLength);
        controller.terminal.write(missing);
        controller.writtenOutputLength = output.length;
      }
      sync.ready = true;
      for (const event of sync.buffered.sort((left, right) => left.revision - right.revision)) {
        if (event.revision <= sync.revision) continue;
        sync.revision = event.revision;
        applyEventRef.current(event);
      }
      sync.buffered = [];
      setSubscribedProjectId(projectId);
    });
    return () => {
      cancelled = true;
      if (syncByProject.current.get(projectId) === sync) syncByProject.current.delete(projectId);
      setTabsByProject((current) => ({ ...current, [projectId]: [] }));
      void window.carrent.terminal.unsubscribe(projectId);
    };
  }, [project?.id]);

  useEffect(() => {
    if (!isOpen || !project || subscribedProjectId !== project.id || tabs.length !== 0) return;
    void createTabRef.current(true);
  }, [isOpen, project, subscribedProjectId, tabs.length]);

  useEffect(() => {
    if (!isOpen) setIsMaximized(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !activeTab) return;
    const timer = window.setTimeout(() => {
      const controller = controllers.current.get(activeTab.id);
      controller?.fit();
      controller?.terminal.focus();
    });
    return () => window.clearTimeout(timer);
  }, [activeTab, isOpen, panelHeight]);

  const activeController = activeTab ? controllers.current.get(activeTab.id) : undefined;

  const dismissCompletion = useCallback(() => {
    if (!activeTab) return;
    setCompletionByTerminal((current) => ({ ...current, [activeTab.id]: undefined }));
  }, [activeTab]);

  const writeCompletionText = useCallback(
    (text: string, candidate?: TerminalCandidate) => {
      if (!activeTab || !activeCompletion) return;
      const replacement = candidate?.replacement;
      const eraseCount = replacement ? activeCompletion.cursor - replacement.start : 0;
      const deleteCount = replacement ? replacement.end - activeCompletion.cursor : 0;
      const data = `${"\u007f".repeat(Math.max(0, eraseCount))}${"\u001b[3~".repeat(
        Math.max(0, deleteCount),
      )}${text}`;
      void window.carrent.terminal.write({
        projectId: activeTab.projectId,
        terminalId: activeTab.id,
        data,
      });
      dismissCompletion();
    },
    [activeCompletion, activeTab, dismissCompletion],
  );

  const acceptCandidate = useCallback(() => {
    const candidate = activeCompletion?.candidates.slice(0, MAX_VISIBLE_CANDIDATES)[candidateIndex];
    if (candidate) writeCompletionText(candidate.insertText, candidate);
  }, [activeCompletion, candidateIndex, writeCompletionText]);

  const acceptPrediction = useCallback(
    (amount: "all" | "word") => {
      const suffix = activeCompletion?.predictionSuffix ?? "";
      if (!suffix) return;
      const boundary = suffix.search(/\s/u);
      writeCompletionText(
        amount === "all" || boundary < 0 ? suffix : suffix.slice(0, boundary + 1),
      );
    },
    [activeCompletion, writeCompletionText],
  );

  const completionAnchor = (() => {
    if (!activeController) return { left: 12, top: 28 };
    const terminal = activeController.terminal;
    return {
      left:
        12 +
        (terminal.buffer.active.cursorX * Math.max(1, terminal.element?.clientWidth ?? 1)) /
          terminal.cols,
      top:
        8 +
        ((terminal.buffer.active.cursorY + 1) * Math.max(1, terminal.element?.clientHeight ?? 1)) /
          terminal.rows,
    };
  })();

  const beginResize = (event: React.MouseEvent) => {
    event.preventDefault();
    resizingRef.current = { startY: event.clientY, startHeight: panelHeight };
    document.body.style.userSelect = "none";
    const move = (moveEvent: MouseEvent) => {
      const state = resizingRef.current;
      if (!state) return;
      setPanelHeight(
        Math.max(
          MIN_TERMINAL_PANEL_HEIGHT,
          Math.min(
            MAX_TERMINAL_PANEL_HEIGHT,
            window.innerHeight - 180,
            state.startHeight + state.startY - moveEvent.clientY,
          ),
        ),
      );
    };
    const end = () => {
      document.body.style.userSelect = "";
      resizingRef.current = null;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      setPanelHeight((height) => {
        updateSetting("terminalPanelHeight", height);
        return height;
      });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", end);
  };

  const runSearch = (direction: "next" | "previous") => {
    if (!activeController || !searchQuery) return;
    if (direction === "next") activeController.search.findNext(searchQuery);
    else activeController.search.findPrevious(searchQuery);
  };

  return (
    <section
      aria-label="Integrated Terminal"
      className={`${isMaximized ? "absolute inset-0 z-30" : "relative shrink-0 border-t"} overflow-hidden border-border bg-[#151514] ${
        isOpen && project ? "" : "hidden"
      }`}
      style={isMaximized ? undefined : { height: panelHeight }}
      onContextMenu={(event) => {
        if (!activeTab) return;
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY, terminalId: activeTab.id });
      }}
    >
      {!isMaximized ? (
        <div
          role="separator"
          aria-label="Resize Integrated Terminal"
          aria-orientation="horizontal"
          onMouseDown={beginResize}
          className="absolute inset-x-0 top-0 z-20 h-1 cursor-row-resize hover:bg-border-strong"
        />
      ) : null}
      <div className="flex h-9 items-center px-2">
        <div
          role="tablist"
          aria-label="Terminal Tabs"
          className="no-scrollbar flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.active}
              className={`group flex h-8 w-56 shrink-0 items-center gap-1 rounded-md px-2 text-app-13 ${
                tab.active ? "bg-surface-raised text-fg" : "text-muted hover:bg-surface"
              }`}
            >
              <SquareTerminal aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-subtle" />
              <button
                type="button"
                className="flex h-full min-w-0 flex-1 -translate-y-px items-center truncate text-left font-medium leading-none"
                onClick={() => void activateTab(tab)}
              >
                {tab.title}
              </button>
              {tab.status === "exited" ? <span className="text-danger">●</span> : null}
              <button
                type="button"
                aria-label={`Close ${tab.title}`}
                title="Close Terminal Tab"
                onClick={() => void closeTab(tab)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle opacity-0 hover:bg-surface-hover hover:text-fg group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label="New Terminal Tab"
          title="New Terminal Tab"
          disabled={loadingProjectId === project?.id}
          onClick={() => void createTab()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-surface-hover hover:text-fg disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Search Terminal"
          title="Search Terminal"
          onClick={() => setSearchOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-surface-hover hover:text-fg"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={isMaximized ? "Restore Integrated Terminal" : "Maximize Integrated Terminal"}
          title={isMaximized ? "Restore Integrated Terminal" : "Maximize Integrated Terminal"}
          aria-pressed={isMaximized}
          onClick={() => setIsMaximized((maximized) => !maximized)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-surface-hover hover:text-fg"
        >
          {isMaximized ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {searchOpen ? (
        <div className="absolute right-2 top-10 z-20 flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-1 shadow-lg">
          <input
            autoFocus
            aria-label="Search terminal output"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") runSearch(event.shiftKey ? "previous" : "next");
              if (event.key === "Escape") setSearchOpen(false);
            }}
            className="h-6 w-48 bg-transparent px-1 text-app-12 text-fg outline-none"
          />
          <button
            type="button"
            aria-label="Previous match"
            onClick={() => runSearch("previous")}
            className="flex h-6 w-6 items-center justify-center text-subtle hover:text-fg"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Next match"
            onClick={() => runSearch("next")}
            className="flex h-6 w-6 items-center justify-center text-subtle hover:text-fg"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
            className="flex h-6 w-6 items-center justify-center text-subtle hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="h-[calc(100%-2.25rem)] min-h-0">
        {tabs.map((tab) => (
          <div key={tab.id} className={tab.id === activeTab?.id ? "relative h-full p-2" : "hidden"}>
            <TerminalViewport
              tab={tab}
              visible={isOpen && tab.id === activeTab?.id}
              register={register}
              onCreateTab={() => void createTab()}
              onCloseTab={() => void closeTab(tab)}
              onSearch={() => setSearchOpen(true)}
              completion={tab.id === activeTab?.id ? activeCompletion : null}
              onDismissCompletion={dismissCompletion}
              onMoveCandidate={(direction) =>
                setCandidateIndex((index) => {
                  const count = Math.min(
                    activeCompletion?.candidates.length ?? 0,
                    MAX_VISIBLE_CANDIDATES,
                  );
                  return count === 0 ? 0 : (index + direction + count) % count;
                })
              }
              onAcceptCandidate={acceptCandidate}
              onAcceptPrediction={acceptPrediction}
              onFocusChange={onFocusChange}
            />
            {tab.id === activeTab?.id && activeCompletion?.predictionSuffix ? (
              <span
                aria-label="Terminal history prediction"
                className="pointer-events-none absolute z-10 whitespace-pre font-mono text-[13px] text-subtle"
                style={{ left: completionAnchor.left, top: completionAnchor.top - 16 }}
              >
                {activeCompletion.predictionSuffix}
              </span>
            ) : null}
            {tab.id === activeTab?.id && activeCompletion?.candidates.length ? (
              <div
                role="listbox"
                aria-label="Terminal command candidates"
                aria-activedescendant={`terminal-candidate-${candidateIndex}`}
                className="absolute z-20 max-h-56 w-72 overflow-auto rounded-md border border-border bg-surface p-1 shadow-xl"
                style={{
                  left: Math.min(completionAnchor.left, 300),
                  top: `max(0px, min(${completionAnchor.top}px, calc(100% - 15rem)))`,
                }}
              >
                {activeCompletion.candidates
                  .slice(0, MAX_VISIBLE_CANDIDATES)
                  .map((candidate, index) => (
                    <button
                      id={`terminal-candidate-${index}`}
                      key={`${candidate.kind}:${candidate.label}`}
                      type="button"
                      role="option"
                      aria-selected={candidateIndex === index}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => writeCompletionText(candidate.insertText, candidate)}
                      className={`flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-app-12 ${
                        candidateIndex === index
                          ? "bg-surface-hover text-fg"
                          : "text-muted hover:bg-surface-raised"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate font-mono">{candidate.label}</span>
                      {candidate.description ? (
                        <span className="max-w-36 truncate text-app-11 text-subtle">
                          {candidate.description}
                        </span>
                      ) : null}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {contextMenu ? (
        <div
          role="menu"
          aria-label="Terminal actions"
          className="fixed z-50 min-w-48 rounded-md border border-border bg-surface p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {[
            {
              label: "Copy",
              disabled: !activeController?.terminal.hasSelection(),
              action: () =>
                window.carrent.clipboard.writeText(activeController?.terminal.getSelection() ?? ""),
            },
            {
              label: "Paste",
              action: async () =>
                activeController?.terminal.paste(await window.carrent.clipboard.readText()),
            },
            { label: "Select All", action: () => activeController?.terminal.selectAll() },
            { label: "Clear", action: () => activeController?.terminal.clear() },
            { label: "Terminate Current Terminal", action: () => closeTab(activeTab) },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setContextMenu(null);
                void item.action();
              }}
              className="flex h-8 w-full items-center rounded px-2 text-left text-app-12 text-fg hover:bg-surface-hover disabled:text-subtle"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
