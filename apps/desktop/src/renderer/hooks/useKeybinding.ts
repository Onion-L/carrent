import { useCallback, useEffect, useMemo, useRef } from "react";

import type { ActionId, KeybindingInput } from "../../shared/keybindings";
import { useSettings } from "../context/SettingsContext";
import {
  isKeybindingRecorderTarget,
  isKeybindingTextInputTarget,
  getKeybindingScope,
  isKeybindingActionActive,
  isSameBinding,
  normalizeModifiers,
  resolveKeybindings,
} from "../lib/keybindings";
import { KEYBINDING_ACTION_BY_ID } from "../lib/defaultKeybindings";

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
  const bindings = useMemo(
    () => resolveKeybindings(actionId, keybindingOverrides),
    [actionId, keybindingOverrides],
  );
  const scopes = KEYBINDING_ACTION_BY_ID[actionId].scopes;

  // Latest-ref so a new inline handler does not re-register the listener.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  const removeListenerRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (bindings.length === 0) {
      removeListenerRef.current = () => {};
      return;
    }

    const matchesInput = (input: KeybindingInput | KeyboardEvent) =>
      scopes.includes(
        ("scope" in input ? input.scope : undefined) ?? getKeybindingScope(document.activeElement),
      ) && bindings.some((binding) => isSameBinding(normalizeModifiers(input), binding));
    const runIfMatching = (input: KeybindingInput) => {
      if (!isKeybindingActionActive(actionId)) return;
      if (input.actionIds ? !input.actionIds.includes(actionId) : !matchesInput(input)) return;
      handlerRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isKeybindingActionActive(actionId)) return;
      if (isKeybindingRecorderTarget(event.target)) return;
      const scope = getKeybindingScope(event.target);
      if (
        bindings.some((binding) => binding.modifiers.length === 0) &&
        event.key.length === 1 &&
        isKeybindingTextInputTarget(event.target) &&
        scope !== "terminal"
      ) {
        return;
      }
      if (!scopes.includes(scope) || !matchesInput(event)) return;
      event.preventDefault();
      handlerRef.current();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    const removeShortcutInputListener =
      window.carrent?.keybindings?.onShortcutInput(runIfMatching) ?? (() => {});
    const removeListener = () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      removeShortcutInputListener();
    };
    removeListenerRef.current = removeListener;
    return removeListener;
  }, [bindings, scopes]);

  return useCallback(() => removeListenerRef.current(), []);
}
