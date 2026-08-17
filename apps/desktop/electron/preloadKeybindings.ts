import type { KeybindingInput, KeybindingsApi } from "../src/shared/keybindings";

type InputListener = (event: unknown, input: KeybindingInput) => void;

type IpcRendererLike = {
  send: (channel: string, value: unknown) => void;
  on: (channel: string, listener: InputListener) => void;
  removeListener: (channel: string, listener: InputListener) => void;
};

export function createKeybindingsPreloadApi(ipcRenderer: IpcRendererLike): KeybindingsApi {
  const subscribe = (
    channel: "keybindings:recording-input",
    listener: (input: KeybindingInput) => void,
  ) => {
    const wrapped: InputListener = (_event, input) => listener(input);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  };
  const shortcutListeners = new Set<(input: KeybindingInput) => void>();
  let shortcutBridge: InputListener | null = null;

  const subscribeToShortcuts = (listener: (input: KeybindingInput) => void) => {
    shortcutListeners.add(listener);
    if (!shortcutBridge) {
      shortcutBridge = (_event, input) => {
        for (const current of shortcutListeners) current(input);
      };
      ipcRenderer.on("keybindings:shortcut-input", shortcutBridge);
    }
    return () => {
      shortcutListeners.delete(listener);
      if (shortcutListeners.size === 0 && shortcutBridge) {
        ipcRenderer.removeListener("keybindings:shortcut-input", shortcutBridge);
        shortcutBridge = null;
      }
    };
  };

  return {
    setBindings: (bindings) => ipcRenderer.send("keybindings:set-bindings", bindings),
    setRecording: (active) => ipcRenderer.send("keybindings:set-recording", active),
    onInput: (listener) => subscribe("keybindings:recording-input", listener),
    onShortcutInput: subscribeToShortcuts,
  };
}
