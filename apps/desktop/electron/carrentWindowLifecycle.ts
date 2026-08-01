type CarrentWindowIdentity = {
  windowId: number;
  contentsId: number;
};

type CarrentWindowLike = {
  id: number;
  webContents: { id: number };
  on: (event: "closed", listener: () => void) => void;
};

export function registerCarrentWindowCleanup(
  window: CarrentWindowLike,
  cleanup: (identity: CarrentWindowIdentity) => void,
) {
  const identity = { windowId: window.id, contentsId: window.webContents.id };
  window.on("closed", () => cleanup(identity));
}

export function handleCarrentWindowActivation(options: {
  windowCount: () => number;
  createRecoveredWindow: () => void;
  focusMostRecent: () => void;
}) {
  if (options.windowCount() === 0) {
    options.createRecoveredWindow();
    return;
  }
  options.focusMostRecent();
}
