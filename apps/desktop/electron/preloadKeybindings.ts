import type { KeybindingInput, KeybindingsApi } from "../src/shared/keybindings";

type InputListener = (event: unknown, input: KeybindingInput) => void;

type IpcRendererLike = {
  send: (channel: string, value: unknown) => void;
  on: (channel: string, listener: InputListener) => void;
  removeListener: (channel: string, listener: InputListener) => void;
};

export function createKeybindingsPreloadApi(ipcRenderer: IpcRendererLike): KeybindingsApi {
  const subscribe = (
    channel: "keybindings:recording-input" | "keybindings:shortcut-input",
    listener: (input: KeybindingInput) => void,
  ) => {
    const wrapped: InputListener = (_event, input) => listener(input);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  };

  return {
    setRecording: (active) => ipcRenderer.send("keybindings:set-recording", active),
    onInput: (listener) => subscribe("keybindings:recording-input", listener),
    onShortcutInput: (listener) => subscribe("keybindings:shortcut-input", listener),
  };
}
