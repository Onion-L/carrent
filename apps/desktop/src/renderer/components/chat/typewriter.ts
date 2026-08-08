// Smooth streaming text reveal for the active assistant message.
//
// Authoritative Run text advances immediately in the shared Run state; this
// module owns only the Carrent Window-local reveal position. Deltas are
// coalesced into one visible commit per animation frame, the reveal speed
// adapts to the pending backlog, and ordering-sensitive boundaries (activity
// parts, terminal states, snapshots) flush or replace the buffer explicitly.

export const TYPEWRITER_BASE_CHARS_PER_FRAME = 3;
export const TYPEWRITER_SMOOTH_BACKLOG_CHARS = 64;
export const TYPEWRITER_BACKLOG_ACCELERATION = 8;
// Terminal catch-up ceiling: at ~60fps this bounds the post-completion
// animation to well under half a second.
export const TYPEWRITER_MAX_CATCH_UP_FRAMES = 24;

export function getTypewriterCharsPerFrame(pendingChars: number): number {
  if (pendingChars <= TYPEWRITER_SMOOTH_BACKLOG_CHARS) {
    return TYPEWRITER_BASE_CHARS_PER_FRAME;
  }
  return Math.ceil(pendingChars / TYPEWRITER_BACKLOG_ACCELERATION);
}

export function getNextTypewriterText(visibleText: string, receivedText: string): string {
  if (!receivedText.startsWith(visibleText)) {
    return receivedText;
  }

  if (visibleText.length >= receivedText.length) {
    return visibleText;
  }

  return receivedText.slice(
    0,
    Math.min(
      receivedText.length,
      visibleText.length + getTypewriterCharsPerFrame(receivedText.length - visibleText.length),
    ),
  );
}

export function hasPendingTypewriterText(visibleText: string, receivedText: string): boolean {
  return visibleText.length < receivedText.length;
}

function estimateConvergenceFrames(pendingChars: number): number {
  let frames = 0;
  let pending = pendingChars;
  while (pending > 0 && frames <= TYPEWRITER_MAX_CATCH_UP_FRAMES) {
    pending -= getTypewriterCharsPerFrame(pending);
    frames += 1;
  }
  return frames;
}

export type StreamingTextRevealerOptions = {
  // Receives the next visible-text delta; concatenating every delta in order
  // always yields the current visible text.
  onReveal: (text: string) => void;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (frameId: number) => void;
  // Reduced-motion preference: skip progressive reveal, show everything that
  // has arrived on the next frame.
  shouldRevealAll?: () => boolean;
};

export class StreamingTextRevealer {
  private receivedText = "";
  private visibleText = "";
  private frameId: number | null = null;
  private disposed = false;

  private readonly requestFrame: (callback: () => void) => number;
  private readonly cancelFrame: (frameId: number) => void;
  private readonly shouldRevealAll: () => boolean;

  constructor(private readonly options: StreamingTextRevealerOptions) {
    this.requestFrame =
      options.requestFrame ?? ((callback) => globalThis.requestAnimationFrame(callback));
    this.cancelFrame =
      options.cancelFrame ?? ((frameId) => globalThis.cancelAnimationFrame(frameId));
    this.shouldRevealAll =
      options.shouldRevealAll ??
      (() => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }

  appendDelta(text: string): void {
    if (this.disposed || !text) {
      return;
    }
    this.receivedText += text;
    this.scheduleFrame();
  }

  // An authoritative snapshot replaces both buffers atomically. Committing the
  // replacement is the caller's job (it owns the message update); here we only
  // cancel stale scheduling so no delta derived from the superseded buffer can
  // be appended afterwards.
  applySnapshot(text: string): void {
    this.cancelScheduledFrame();
    this.receivedText = text;
    this.visibleText = text;
  }

  // Reveal everything that has been received, right now. Used before parts
  // whose ordering depends on the preceding text, and on failure/cancel.
  flush(): void {
    this.cancelScheduledFrame();
    if (this.visibleText === this.receivedText) {
      return;
    }
    const delta = this.receivedText.slice(this.visibleText.length);
    this.visibleText = this.receivedText;
    this.options.onReveal(delta);
  }

  // Run completed normally: remaining text may finish through the adaptive
  // scheduler only when it converges within the catch-up ceiling; otherwise
  // the final answer is shown immediately.
  finish(finalText: string): void {
    if (!this.receivedText || finalText.startsWith(this.receivedText)) {
      this.receivedText = finalText;
    }
    const pending = this.receivedText.length - this.visibleText.length;
    if (pending <= 0) {
      return;
    }
    if (
      !this.shouldRevealAll() &&
      estimateConvergenceFrames(pending) <= TYPEWRITER_MAX_CATCH_UP_FRAMES
    ) {
      this.scheduleFrame();
      return;
    }
    this.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelScheduledFrame();
  }

  private scheduleFrame(): void {
    if (this.disposed || this.frameId !== null) {
      return;
    }
    if (!hasPendingTypewriterText(this.visibleText, this.receivedText)) {
      return;
    }
    this.frameId = this.requestFrame(this.step);
  }

  private cancelScheduledFrame(): void {
    if (this.frameId === null) {
      return;
    }
    this.cancelFrame(this.frameId);
    this.frameId = null;
  }

  private step = (): void => {
    this.frameId = null;
    if (this.disposed) {
      return;
    }

    const nextVisibleText = this.shouldRevealAll()
      ? this.receivedText
      : getNextTypewriterText(this.visibleText, this.receivedText);
    if (nextVisibleText !== this.visibleText) {
      const delta = nextVisibleText.slice(this.visibleText.length);
      this.visibleText = nextVisibleText;
      this.options.onReveal(delta);
    }

    if (hasPendingTypewriterText(this.visibleText, this.receivedText)) {
      this.scheduleFrame();
    }
  };
}
