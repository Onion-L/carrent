export type MainWindowZoomAction = "in" | "out" | "reset";

export type MainWindowApi = {
  onNavigate: (listener: (path: string) => void) => VoidFunction;
  zoom: {
    getFactor: () => Promise<number>;
    change: (action: MainWindowZoomAction) => Promise<number>;
    onFactorChange: (listener: (factor: number) => void) => VoidFunction;
  };
};
