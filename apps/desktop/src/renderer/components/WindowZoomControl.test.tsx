import { afterEach, describe, expect, it } from "bun:test";

import "../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { MainWindowZoomAction } from "../../shared/mainWindow";
import { WindowZoomControl } from "./WindowZoomControl";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("WindowZoomControl", () => {
  it("shows the actual zoom percentage and exposes zoom controls", async () => {
    let factor = 1;
    let listener: ((nextFactor: number) => void) | null = null;
    const actions: MainWindowZoomAction[] = [];
    window.carrent = {
      keybindings: {
        setBindings: () => {},
        setRecording: () => {},
        onInput: () => () => {},
        onShortcutInput: () => () => {},
      },
      mainWindow: {
        onNavigate: () => () => {},
        zoom: {
          getFactor: async () => factor,
          change: async (action: MainWindowZoomAction) => {
            actions.push(action);
            factor = action === "in" ? 1.1 : action === "out" ? 0.9 : 1;
            listener?.(factor);
            return factor;
          },
          onFactorChange: (nextListener: (nextFactor: number) => void) => {
            listener = nextListener;
            return () => {
              if (listener === nextListener) listener = null;
            };
          },
        },
      },
    } as unknown as Window["carrent"];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root!.render(<WindowZoomControl />));

    expect(container.querySelector('[aria-label="Window zoom"]')).toBe(null);
    await act(async () => listener?.(1.1));
    expect(container.textContent).toContain("110%");

    const zoomOut = container.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')!;
    await act(async () => zoomOut.click());
    expect(actions).toEqual(["out"]);
    expect(container.textContent).toContain("90%");

    const zoomIn = container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!;
    await act(async () => zoomIn.click());
    expect(actions).toEqual(["out", "in"]);
    expect(container.textContent).toContain("110%");

    const reset = container.querySelector<HTMLButtonElement>('[aria-label="Reset zoom"]')!;
    await act(async () => reset.click());
    expect(actions).toEqual(["out", "in", "reset"]);
    expect(container.textContent).toContain("100%");
  });
});
