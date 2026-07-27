export type MainWindowApi = {
  onNavigate: (listener: (path: string) => void) => VoidFunction;
};
