import { useCallback, useEffect, useRef } from "react";

import type { ActionId, KeybindingInput } from "../../shared/keybindings";
import { useSettings } from "../context/SettingsContext";
import {
  isKeybindingRecorderTarget,
  isKeybindingTextInputTarget,
  isSameBinding,
  normalizeModifiers,
  resolveKeybinding,
} from "../lib/keybindings";

/**
 * Runs `handler` when the effective shortcut for `actionId` (user override or
 * default) fires. The keydown listener attaches to `window` in the capture
 * phase, so shortcuts fire before focused inputs and the terminal. Electron
 * menu accelerators that do not reach renderer keydown are delivered through
 * the preload input channel and matched by the same rule. The hook
 * re-registers when the effective binding changes and listens to nothing while
 * the binding is cleared. Returns a disposer for callers that need to stop
 * listening before unmount; unmount and rebinding are handled by the effect
 * cleanup.
 */
export function useKeybinding(actionId: ActionId, handler: () => void): () => void {
  const { keybindingOverrides } = useSettings();
  const binding = resolveKeybinding(actionId, keybindingOverrides);

  // Latest-ref so a new inline handler does not re-register the listener.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const removeListenerRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!binding) {
      removeListenerRef.current = () => {};
      return;
    }

    const matchesInput = (input: KeybindingInput | KeyboardEvent) =>
      isSameBinding(normalizeModifiers(input), binding);
    const runIfMatching = (input: KeybindingInput) => {
      if (!matchesInput(input)) return;
      handlerRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isKeybindingRecorderTarget(event.target)) return;
      if (
        binding.modifiers.length === 0 &&
        event.key.length === 1 &&
        isKeybindingTextInputTarget(event.target)
      ) {
        return;
      }
      if (!matchesInput(event)) return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    const removeShortcutInputListener = window.carrent.keybindings.onShortcutInput(runIfMatching);
    const removeListener = () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      removeShortcutInputListener();
    };
    removeListenerRef.current = removeListener;
    return removeListener;
  }, [binding]);

  return useCallback(() => removeListenerRef.current(), []);
}
