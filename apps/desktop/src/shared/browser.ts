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

export type BrowserApi = {
  activate: (target: BrowserThreadTarget | null) => Promise<BrowserThreadState | null>;
  open: (request: BrowserOpenRequest) => Promise<BrowserThreadState>;
  newTab: (target: BrowserThreadTarget) => Promise<BrowserThreadState>;
  activateTab: (target: BrowserTabTarget) => Promise<BrowserThreadState>;
  closeTab: (target: BrowserTabTarget) => Promise<BrowserThreadState>;
  navigate: (request: BrowserNavigateRequest) => Promise<BrowserThreadState>;
  action: (request: BrowserActionRequest) => Promise<BrowserThreadState>;
  zoom: (request: BrowserZoomRequest) => Promise<BrowserThreadState>;
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
};

export const SEARCH_ENGINE_URLS: Record<BrowserSearchEngine, string> = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  duckduckgo: "https://duckduckgo.com/?q=",
};
