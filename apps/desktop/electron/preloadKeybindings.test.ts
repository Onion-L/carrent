import { describe, expect, it } from "bun:test";

import { createKeybindingsPreloadApi } from "./preloadKeybindings";

describe("Keybindings preload boundary", () => {
  it("sends recording state and removes input listeners", () => {
    const sent: Array<[string, unknown]> = [];
    const listeners = new Map<
      string,
      (
        event: unknown,
        input: {
          key: string;
          metaKey: boolean;
          ctrlKey: boolean;
          altKey: boolean;
          shiftKey: boolean;
        },
      ) => void
    >();
    const removed: string[] = [];
    const api = createKeybindingsPreloadApi({
      send(channel, value) {
        sent.push([channel, value]);
      },
      on(channel, listener) {
        listeners.set(channel, listener);
      },
      removeListener(channel, listener) {
        if (listeners.get(channel) === listener) removed.push(channel);
      },
    });
    const received: string[] = [];

    api.setRecording(true);
    const removeInput = api.onInput((input) => received.push(`recording:${input.key}`));
    const removeShortcut = api.onShortcutInput((input) => received.push(`shortcut:${input.key}`));
    const modifiers = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
    listeners.get("keybindings:recording-input")?.({}, { key: "k", ...modifiers });
    listeners.get("keybindings:shortcut-input")?.({}, { key: "j", ...modifiers });
    removeInput();
    removeShortcut();

    expect(sent).toEqual([["keybindings:set-recording", true]]);
    expect(received).toEqual(["recording:k", "shortcut:j"]);
    expect(removed).toEqual(["keybindings:recording-input", "keybindings:shortcut-input"]);
  });
});
