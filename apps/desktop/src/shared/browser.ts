export type BrowserSearchEngine = "google" | "bing" | "duckduckgo";

export type BrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserTab = {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  certificateError?: { url: string; error: string };
};

export type BrowserThreadState = {
  threadId: string;
  projectId: string;
  open: boolean;
  placement: "side" | "window";
  activeTabId: string | null;
  tabs: BrowserTab[];
  searchEngine: BrowserSearchEngine;
  focusSequence: number;
  contentOwned: boolean;
};

export type BrowserThreadTarget = {
  threadId: string;
  projectId: string;
};

export type BrowserOpenRequest = BrowserThreadTarget & {
  url?: string;
};

export type BrowserTabTarget = BrowserThreadTarget & {
  tabId: string;
};

export type BrowserNavigateRequest = BrowserTabTarget & {
  value: string;
};

export type BrowserActionRequest = BrowserTabTarget & {
  action: "back" | "forward" | "reload" | "stop" | "devtools";
};

export type BrowserZoomRequest = BrowserTabTarget & {
  action: "in" | "out" | "reset";
};

export type BrowserClearDataRequest = BrowserThreadTarget & {
  scope: "project" | "all";
};

export type BrowserMenuMode = "main" | "data" | "settings";

export type BrowserMenuOpenRequest = BrowserTabTarget & {
  anchor: BrowserBounds;
  theme: "light" | "dark";
};

export type BrowserMenuSession = { token: string };

export type BrowserMenuUpdateRequest = BrowserTabTarget & {
  token: string;
  anchor: BrowserBounds;
};

export type BrowserMenuCloseRequest = BrowserTabTarget & { token: string };

export type BrowserMenuAction =
  | { type: "set-mode"; mode: BrowserMenuMode }
  | { type: "find" }
  | { type: "zoom"; action: "in" | "out" | "reset" }
  | { type: "copy-link" }
  | { type: "open-external" }
  | { type: "devtools" }
  | { type: "clear-data"; scope: "project" | "all" }
  | { type: "set-search-engine"; searchEngine: BrowserSearchEngine };

export type BrowserMenuActionEvent = BrowserTabTarget & {
  token: string;
  action: BrowserMenuAction;
};

export type BrowserMenuClosedEvent = BrowserTabTarget & { token: string };

export type BrowserMenuOverlayState = BrowserTabTarget & {
  token: string;
  mode: BrowserMenuMode;
  zoomFactor: number;
  searchEngine: BrowserSearchEngine;
  theme: "light" | "dark";
};

export type BrowserMenuOverlayApi = {
  ready: () => Promise<void>;
  action: (request: { token: string; action: BrowserMenuAction }) => Promise<void>;
  onState: (listener: (state: BrowserMenuOverlayState) => void) => VoidFunction;
};

export type BrowserApi = {
  activate: (target: BrowserThreadTarget | null) => Promise<BrowserThreadState | null>;
  open: (request: BrowserOpenRequest) => Promise<BrowserThreadState>;
  newTab: (target: BrowserThreadTarget) => Promise<BrowserThreadState>;
  activateTab: (target: BrowserTabTarget) => Promise<BrowserThreadState>;
  closeTab: (target: BrowserTabTarget) => Promise<BrowserThreadState>;
  navigate: (request: BrowserNavigateRequest) => Promise<BrowserThreadState>;
  action: (request: BrowserActionRequest) => Promise<BrowserThreadState>;
  zoom: (request: BrowserZoomRequest) => Promise<BrowserThreadState>;
  openMenu: (request: BrowserMenuOpenRequest) => Promise<BrowserMenuSession>;
  updateMenu: (request: BrowserMenuUpdateRequest) => Promise<void>;
  closeMenu: (request: BrowserMenuCloseRequest) => Promise<void>;
  find: (target: BrowserTabTarget & { text: string; forward?: boolean }) => Promise<void>;
  stopFind: (target: BrowserTabTarget) => Promise<void>;
  continueCertificate: (target: BrowserTabTarget) => Promise<BrowserThreadState>;
  setBounds: (target: BrowserThreadTarget & { bounds: BrowserBounds }) => Promise<void>;
  setVisible: (target: BrowserThreadTarget & { visible: boolean }) => Promise<void>;
  popOut: (target: BrowserThreadTarget) => Promise<BrowserThreadState>;
  dock: (target: BrowserThreadTarget) => Promise<BrowserThreadState>;
  openExternal: (target: BrowserTabTarget) => Promise<void>;
  clearData: (request: BrowserClearDataRequest) => Promise<BrowserThreadState>;
  setSearchEngine: (
    target: BrowserThreadTarget & { searchEngine: BrowserSearchEngine },
  ) => Promise<BrowserThreadState>;
  onState: (listener: (state: BrowserThreadState) => void) => VoidFunction;
  onFocusAddress: (listener: () => void) => VoidFunction;
  onFind: (listener: () => void) => VoidFunction;
  onMenuAction: (listener: (event: BrowserMenuActionEvent) => void) => VoidFunction;
  onMenuClosed: (listener: (event: BrowserMenuClosedEvent) => void) => VoidFunction;
};

export const SEARCH_ENGINE_URLS: Record<BrowserSearchEngine, string> = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
};
