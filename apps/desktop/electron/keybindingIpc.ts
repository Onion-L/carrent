import { ACTION_IDS, isKeyBinding, type EffectiveKeybindingMap } from "../src/shared/keybindings";

type IpcMainLike = {
  on: (
    channel: string,
    listener: (event: { sender: { id: number } }, active: unknown) => void,
  ) => void;
};

type KeybindingController = {
  setRecording: (contentsId: number, active: boolean) => void;
  setBindings?: (contentsId: number, bindings: EffectiveKeybindingMap) => void;
};

function isEffectiveKeybindingMap(value: unknown): value is EffectiveKeybindingMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  for (const scope of ["app", "terminal", "browser"] as const) {
    const bindings = candidate[scope];
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return false;
    for (const [actionId, actionBindings] of Object.entries(bindings)) {
      if (!ACTION_IDS.includes(actionId as (typeof ACTION_IDS)[number])) return false;
      if (!Array.isArray(actionBindings) || !actionBindings.every(isKeyBinding)) return false;
    }
  }
  return true;
}

export function registerKeybindingIpc(ipcMain: IpcMainLike, controller: KeybindingController) {
  ipcMain.on("keybindings:set-recording", (event, active) => {
    if (typeof active !== "boolean") return;
    controller.setRecording(event.sender.id, active);
  });
  ipcMain.on("keybindings:set-bindings", (event, bindings) => {
    if (!isEffectiveKeybindingMap(bindings)) return;
    controller.setBindings?.(event.sender.id, bindings);
  });
}
