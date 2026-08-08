// Controllable animation-frame harness for renderer tests. Replaces the real
// requestAnimationFrame/cancelAnimationFrame with a manual queue so one frame
// can be advanced deterministically without wall-clock sleeps.
import { act } from "react";

let realRequestAnimationFrame: typeof window.requestAnimationFrame | null = null;
let realCancelAnimationFrame: typeof window.cancelAnimationFrame | null = null;
const frameCallbacks = new Map<number, FrameRequestCallback>();

export function stubAnimationFrames() {
  realRequestAnimationFrame = window.requestAnimationFrame;
  realCancelAnimationFrame = window.cancelAnimationFrame;
  frameCallbacks.clear();
  let nextId = 1;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    frameCallbacks.set(id, callback);
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    frameCallbacks.delete(id);
  }) as typeof window.cancelAnimationFrame;
}

export function restoreAnimationFrames() {
  if (realRequestAnimationFrame) {
    window.requestAnimationFrame = realRequestAnimationFrame;
    realRequestAnimationFrame = null;
  }
  if (realCancelAnimationFrame) {
    window.cancelAnimationFrame = realCancelAnimationFrame;
    realCancelAnimationFrame = null;
  }
  frameCallbacks.clear();
}

export function runAnimationFrame() {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  act(() => {
    callbacks.forEach((callback) => callback(0));
  });
}

export function pendingAnimationFrameCount() {
  return frameCallbacks.size;
}

export function clearPendingAnimationFrames() {
  frameCallbacks.clear();
}
