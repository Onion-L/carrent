import { describe, expect, it } from "bun:test";

import { registerKeybindingIpc } from "./keybindingIpc";

describe("registerKeybindingIpc", () => {
  it("registers the recording channel and validates its payload", () => {
    const handlers = new Map<
      string,
      (event: { sender: { id: number } }, active: unknown) => void
    >();
    const updates: Array<[number, boolean]> = [];

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
      },
    );

    expect([...handlers.keys()]).toEqual(["keybindings:set-recording"]);
    handlers.get("keybindings:set-recording")?.({ sender: { id: 42 } }, true);
    handlers.get("keybindings:set-recording")?.({ sender: { id: 42 } }, "true");
    expect(updates).toEqual([[42, true]]);
  });
});
