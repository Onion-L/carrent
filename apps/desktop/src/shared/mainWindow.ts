export type MainWindowZoomAction = "in" | "out" | "reset";

export type CarrentWindowsApi = {
  // Opens the given Thread route in a new peer Carrent Window. A Thread is the
  // only entry point for creating a window; there is no empty-window command.
  openThread: (route: string) => Promise<void>;
  // Non-blocking notification that a window creation failed; existing windows
  // are left unchanged.
  onOpenError: (listener: (message: string) => void) => VoidFunction;
  // Keeps the Main Process registry aligned with this Carrent Window's current
  // route so deep links can target an existing matching Thread.
  reportRoute: (route: string) => void;
  // Quit-time capture: the main process asks for this window's current route so
  // the window session can be persisted and restored on the next launch.
  onCaptureRequest: (listener: () => void) => VoidFunction;
  captureDone: (route: string) => Promise<void>;
};

export type MainWindowApi = {
  onNavigate: (listener: (path: string) => void) => VoidFunction;
  zoom: {
    getFactor: () => Promise<number>;
    change: (action: MainWindowZoomAction) => Promise<number>;
    onFactorChange: (listener: (factor: number) => void) => VoidFunction;
  };
  windows: CarrentWindowsApi;
  // Fired by the main process when Cmd+W is pressed while a terminal holds
  // focus, so the renderer can close the active terminal tab instead of the
  // window. No payload; the renderer decides which tab to close.
  onCmdWCloseTab: (listener: () => void) => VoidFunction;
};
