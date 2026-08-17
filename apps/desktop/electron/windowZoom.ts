import type { MainWindowZoomAction } from "../src/shared/mainWindow";

const ZOOM_FACTORS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
const ZOOM_CHANGED_CHANNEL = "app:zoom-changed";

type ZoomWebContents = {
  getZoomFactor: () => number;
  setZoomFactor: (factor: number) => void;
  send: (channel: string, factor: number) => void;
  isDestroyed: () => boolean;
};

type NativeWindowZoomInput = {
  type: string;
  key: string;
  code: string;
  control: boolean;
  meta: boolean;
};

type PreventableEvent = {
  preventDefault: () => void;
};

function nextZoomFactor(currentFactor: number, action: MainWindowZoomAction) {
  if (action === "reset") return 1;
  if (action === "in") {
    return (
      ZOOM_FACTORS.find((factor) => factor > currentFactor + Number.EPSILON) ?? ZOOM_FACTORS.at(-1)!
    );
  }
  return (
    [...ZOOM_FACTORS].reverse().find((factor) => factor < currentFactor - Number.EPSILON) ??
    ZOOM_FACTORS[0]
  );
}

export function isNativeWindowZoomShortcut(input: NativeWindowZoomInput): boolean {
  if (input.type !== "keyDown" || (!input.meta && !input.control)) return false;
  return (
    input.key === "+" ||
    input.key === "=" ||
    input.key === "-" ||
    input.key === "0" ||
    input.code === "NumpadAdd" ||
    input.code === "NumpadSubtract" ||
    input.code === "Numpad0"
  );
}

export function createWindowZoomController(getWebContents: () => ZoomWebContents | null) {
  const getFactor = () => {
    const webContents = getWebContents();
    return webContents && !webContents.isDestroyed() ? webContents.getZoomFactor() : 1;
  };

  const change = (action: MainWindowZoomAction) => {
    const webContents = getWebContents();
    if (!webContents || webContents.isDestroyed()) return 1;
    const factor = nextZoomFactor(webContents.getZoomFactor(), action);
    webContents.setZoomFactor(factor);
    webContents.send(ZOOM_CHANGED_CHANNEL, factor);
    return factor;
  };

  return {
    getFactor,
    change,
    handleZoomChanged(event: PreventableEvent, direction: "in" | "out") {
      event.preventDefault();
      change(direction);
    },
  };
}
