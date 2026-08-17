import { describe, expect, it } from "bun:test";

import { createKeybindingRecordingController } from "./keybindingRecording";

describe("createKeybindingRecordingController", () => {
  it("intercepts and forwards keydown input while the renderer is recording", () => {
    const controller = createKeybindingRecordingController();
    const received: unknown[] = [];
    let prevented = 0;

    controller.setRecording(42, true);

    expect(
      controller.handleBeforeInput(
        42,
        { preventDefault: () => (prevented += 1) },
        {
          type: "keyDown",
          key: "Q",
          meta: true,
          control: false,
          alt: false,
          shift: true,
        },
        (input) => received.push(input),
      ),
    ).toBe(true);
    expect(prevented).toBe(1);
    expect(received).toEqual([
      {
        key: "Q",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      },
    ]);
  });

  it("leaves input alone when the renderer is not recording a keydown", () => {
    const controller = createKeybindingRecordingController();
    let prevented = 0;
    let sent = 0;
    const event = { preventDefault: () => (prevented += 1) };
    const input = {
      type: "keyDown",
      key: "=",
      meta: true,
      control: false,
      alt: false,
      shift: false,
    };

    expect(controller.handleBeforeInput(42, event, input, () => (sent += 1))).toBe(false);

    controller.setRecording(42, true);
    expect(
      controller.handleBeforeInput(42, event, { ...input, type: "keyUp" }, () => (sent += 1)),
    ).toBe(false);

    controller.clear(42);
    expect(controller.handleBeforeInput(42, event, input, () => (sent += 1))).toBe(false);
    expect(prevented).toBe(0);
    expect(sent).toBe(0);
  });

  it("reports Cmd+Tab when macOS switches apps before Electron receives Tab", () => {
    const controller = createKeybindingRecordingController();
    const received: unknown[] = [];

    controller.setRecording(42, true);
    controller.handleBeforeInput(
      42,
      { preventDefault: () => {} },
      {
        type: "keyDown",
        key: "Meta",
        meta: true,
        control: false,
        alt: false,
        shift: false,
      },
      () => {},
    );

    expect(controller.handleWindowBlur(42, (input) => received.push(input))).toBe(true);
    expect(received).toEqual([
      {
        key: "Tab",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
    ]);
    expect(controller.handleWindowBlur(42, () => {})).toBe(false);
  });

  it("does not infer Cmd+Tab after another Meta shortcut was received", () => {
    const controller = createKeybindingRecordingController();
    const event = { preventDefault: () => {} };

    controller.setRecording(42, true);
    controller.handleBeforeInput(
      42,
      event,
      {
        type: "keyDown",
        key: "Meta",
        meta: true,
        control: false,
        alt: false,
        shift: false,
      },
      () => {},
    );
    controller.handleBeforeInput(
      42,
      event,
      {
        type: "keyDown",
        key: "q",
        meta: true,
        control: false,
        alt: false,
        shift: false,
      },
      () => {},
    );

    expect(controller.handleWindowBlur(42, () => {})).toBe(false);
  });
});
