export type MainWindowZoomAction = "in" | "out" | "reset";

export type CarrentWindowsApi = {
  // Opens the given Thread route in a new peer Carrent Window. A Thread is the
  // only entry point for creating a window; there is no empty-window command.
  openThread: (route: string) => Promise<void>;
  // Non-blocking notification that a window creation failed; existing windows
  // are left unchanged.
  onOpenError: (listener: (message: string) => void) => VoidFunction;
};

export type MainWindowApi = {
  onNavigate: (listener: (path: string) => void) => VoidFunction;
  zoom: {
    getFactor: () => Promise<number>;
    change: (action: MainWindowZoomAction) => Promise<number>;
    onFactorChange: (listener: (factor: number) => void) => VoidFunction;
  };
  windows: CarrentWindowsApi;
};
