import { describe, expect, it } from "bun:test";

import { registerKeybindingIpc } from "./keybindingIpc";

describe("registerKeybindingIpc", () => {
  it("registers the runtime and recording channels and validates their payloads", () => {
    const handlers = new Map<
      string,
      (event: { sender: { id: number } }, active: unknown) => void
    >();
    const updates: Array<[number, boolean]> = [];
    const bindingUpdates: unknown[] = [];

    registerKeybindingIpc(
      {
        on(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      {
        setRecording(contentsId, active) {
          updates.push([contentsId, active]);
        },
        setBindings(contentsId, bindings) {
          bindingUpdates.push([contentsId, bindings]);
        },
      },
    );

    expect([...handlers.keys()]).toEqual(["keybindings:set-recording", "keybindings:set-bindings"]);
    handlers.get("keybindings:set-recording")?.({ sender: { id: 42 } }, true);
    handlers.get("keybindings:set-recording")?.({ sender: { id: 42 } }, "true");
    const bindings = { app: {}, terminal: {}, browser: {} };
    handlers.get("keybindings:set-bindings")?.({ sender: { id: 42 } }, bindings);
    handlers.get("keybindings:set-bindings")?.(
      { sender: { id: 42 } },
      { app: {}, terminal: {}, browser: { "preview-refresh": true } },
    );
    expect(updates).toEqual([[42, true]]);
    expect(bindingUpdates).toEqual([[42, bindings]]);
  });
});
