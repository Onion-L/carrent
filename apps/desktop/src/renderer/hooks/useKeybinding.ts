import { useCallback, useEffect, useRef } from "react";

import type { ActionId } from "../../shared/keybindings";
import { useSettings } from "../context/SettingsContext";
import { isSameBinding, normalizeModifiers, resolveKeybinding } from "../lib/keybindings";

/**
 * Runs `handler` when the effective shortcut for `actionId` (user override or
 * default) fires. The keydown listener attaches to `window` in the capture
 * phase — as the shell's hardcoded listeners do today, so shortcuts fire
 * before focused inputs and the terminal. Matching follows the canonical
 * binding model (see isSameBinding), which is narrower than the legacy
 * metaKey-or-ctrlKey checks it will replace. The hook re-registers when the
 * effective binding changes and listens to nothing while the binding is
 * cleared. Returns a disposer for callers that need to stop listening before
 * unmount; unmount and rebinding are handled by the effect cleanup.
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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSameBinding(normalizeModifiers(event), binding)) return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    const removeListener = () => window.removeEventListener("keydown", handleKeyDown, true);
    removeListenerRef.current = removeListener;
    return removeListener;
  }, [binding]);

  return useCallback(() => removeListenerRef.current(), []);
}
