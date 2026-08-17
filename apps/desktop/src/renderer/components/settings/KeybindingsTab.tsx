import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { RotateCcw } from "lucide-react";

import type { ActionId, KeyBinding, KeybindingInput } from "../../../shared/keybindings";
import { useSettings } from "../../context/SettingsContext";
import {
  detectConflict,
  getKeybindingDisplayParts,
  isReservedKey,
  normalizeModifiers,
  prepareKeybindingUpdate,
  resetKeybindingOverride,
  resolveKeybindings,
} from "../../lib/keybindings";
import { KEYBINDING_ACTIONS, KEYBINDING_ACTION_BY_ID } from "../../lib/defaultKeybindings";

function KeybindingKeys({ binding }: { binding: KeyBinding }) {
  const parts = getKeybindingDisplayParts(binding);

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1.5" aria-hidden="true">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="contents">
          {index > 0 ? <span className="sr-only">+</span> : null}
          <kbd className="inline-flex h-7 min-w-7 items-center justify-center rounded-[5px] border border-border bg-surface-raised px-2 font-mono text-app-12 leading-none text-muted shadow-[0_1px_0_rgb(var(--color-border-strong)/0.28)]">
            {part}
          </kbd>
        </span>
      ))}
    </span>
  );
}

function KeybindingList({ bindings }: { bindings: KeyBinding[] }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      {bindings.map((binding, index) => (
        <Fragment key={`${binding.modifiers.join("+")}-${binding.key}`}>
          {index > 0 ? <span className="text-app-11 text-subtle">or</span> : null}
          <KeybindingKeys binding={binding} />
        </Fragment>
      ))}
    </span>
  );
}

export function KeybindingsTab() {
  const { keybindingOverrides, updateSetting } = useSettings();
  const [recordingActionId, setRecordingActionId] = useState<ActionId | null>(null);
  const [candidate, setCandidate] = useState<KeyBinding | null>(null);
  const recorderRef = useRef<HTMLButtonElement>(null);
  const hasOverrides = Boolean(keybindingOverrides && Object.keys(keybindingOverrides).length > 0);

  useEffect(() => {
    recorderRef.current?.focus();
  }, [recordingActionId]);

  const stopRecording = () => {
    setRecordingActionId(null);
    setCandidate(null);
  };

  const saveCandidate = (actionId: ActionId, confirmedConflictActionId?: ActionId) => {
    if (!candidate) return;
    const update = prepareKeybindingUpdate(
      actionId,
      candidate,
      keybindingOverrides,
      confirmedConflictActionId,
    );
    if (update.status !== "saved") return;
    updateSetting("keybindingOverrides", update.overrides);
    stopRecording();
  };

  const clearBinding = (actionId: ActionId) => {
    const update = prepareKeybindingUpdate(actionId, undefined, keybindingOverrides);
    if (update.status !== "saved") return;
    updateSetting("keybindingOverrides", update.overrides);
    stopRecording();
  };

  const resetBinding = (actionId: ActionId) => {
    updateSetting("keybindingOverrides", resetKeybindingOverride(actionId, keybindingOverrides));
    if (recordingActionId === actionId) stopRecording();
  };

  const resetAllBindings = () => {
    updateSetting("keybindingOverrides", undefined);
    stopRecording();
  };

  const handleRecordedInput = (input: KeybindingInput, actionId: ActionId) => {
    if (input.key === "Escape") {
      stopRecording();
      return;
    }
    if (input.key === "Backspace" || input.key === "Delete") {
      clearBinding(actionId);
      return;
    }
    if (input.key === "Enter") {
      saveCandidate(actionId);
      return;
    }
    if (["Alt", "Control", "Meta", "Shift"].includes(input.key)) return;

    setCandidate(normalizeModifiers(input));
  };
  const recordedInputHandlerRef = useRef(handleRecordedInput);
  recordedInputHandlerRef.current = handleRecordedInput;

  useEffect(() => {
    if (!recordingActionId) return;
    const { keybindings } = window.carrent;

    keybindings.setRecording(true);
    const removeInputListener = keybindings.onInput((input) => {
      recordedInputHandlerRef.current(input, recordingActionId);
    });
    return () => {
      removeInputListener();
      keybindings.setRecording(false);
    };
  }, [recordingActionId]);

  const handleRecorderKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    actionId: ActionId,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    handleRecordedInput(event.nativeEvent, actionId);
  };

  return (
    <div className="border-y border-border">
      <table className="w-full table-fixed border-collapse text-left">
        <thead className="text-app-11 font-medium uppercase text-subtle">
          <tr className="border-b border-border">
            <th className="w-[30%] px-4 py-3 font-medium">Command</th>
            <th className="w-[34%] px-4 py-3 font-medium">Keybinding</th>
            <th className="px-4 py-3 font-medium">When</th>
            <th className="w-24 px-4 py-3 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {KEYBINDING_ACTIONS.map((action, index) => {
            const actionId = action.id;
            const bindings = resolveKeybindings(actionId, keybindingOverrides);
            const hasCustomBinding = Boolean(
              keybindingOverrides && actionId in keybindingOverrides,
            );
            const isRecording = recordingActionId === actionId;
            const reserved =
              isRecording && candidate ? isReservedKey(candidate.key, candidate.modifiers) : null;
            const conflictActionId =
              isRecording && candidate
                ? detectConflict(candidate.key, candidate.modifiers, actionId, keybindingOverrides)
                : null;
            const feedbackId = `keybinding-feedback-${actionId}`;

            const categoryChanged =
              index === 0 || KEYBINDING_ACTIONS[index - 1].category !== action.category;

            return (
              <Fragment key={actionId}>
                {categoryChanged ? (
                  <tr className="border-b border-border bg-surface-raised/45">
                    <th colSpan={4} className="px-4 py-2 text-app-11 font-medium text-subtle">
                      {action.category}
                    </th>
                  </tr>
                ) : null}
                <tr className="border-b border-border align-top transition-colors last:border-b-0 hover:bg-surface-hover/40">
                  <td className="px-4 py-5 text-app-13 text-fg">{action.label}</td>
                  <td
                    className="cursor-pointer px-4 py-3.5"
                    onClick={() => {
                      if (isRecording) return;
                      setRecordingActionId(actionId);
                      setCandidate(null);
                    }}
                  >
                    <div
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          if (candidate && reserved !== "hard" && !conflictActionId) {
                            saveCandidate(actionId);
                          } else {
                            stopRecording();
                          }
                        }
                      }}
                    >
                      <button
                        ref={isRecording ? recorderRef : undefined}
                        type="button"
                        data-keybinding-recorder={isRecording ? "true" : undefined}
                        aria-label={`${action.label} shortcut`}
                        aria-describedby={isRecording && candidate ? feedbackId : undefined}
                        onKeyDown={
                          isRecording
                            ? (event) => handleRecorderKeyDown(event, actionId)
                            : undefined
                        }
                        className={`-ml-1.5 inline-flex min-h-10 min-w-28 max-w-full items-center justify-start rounded-md border px-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/20 ${
                          isRecording
                            ? "border-border-strong bg-surface text-fg"
                            : "border-transparent text-fg hover:bg-surface-hover"
                        }`}
                      >
                        {isRecording ? (
                          candidate ? (
                            <KeybindingKeys binding={candidate} />
                          ) : (
                            <span className="px-1 text-app-12 text-subtle">Press keys...</span>
                          )
                        ) : bindings.length > 0 ? (
                          <KeybindingList bindings={bindings} />
                        ) : (
                          <span className="px-1 text-app-12 text-subtle">Unassigned</span>
                        )}
                      </button>

                      {isRecording && candidate ? (
                        <div id={feedbackId} className="mt-1.5 text-app-11 leading-4">
                          {reserved === "hard" ? (
                            <div role="alert" className="text-danger">
                              This is a reserved system shortcut
                            </div>
                          ) : (
                            <>
                              {reserved === "warning" ? (
                                <div className="text-warning">This is a system shortcut</div>
                              ) : null}
                              {conflictActionId ? (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-warning">
                                  <span>
                                    Already bound to{" "}
                                    {KEYBINDING_ACTION_BY_ID[conflictActionId].label}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => saveCandidate(actionId, conflictActionId)}
                                    className="font-medium underline underline-offset-2 transition-colors hover:text-fg"
                                  >
                                    Use anyway
                                  </button>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-5 text-app-12 text-subtle">{action.whenLabel}</td>
                  <td className="w-24 px-4 py-4 text-right">
                    {hasCustomBinding ? (
                      <button
                        type="button"
                        aria-label={`Reset ${action.label} shortcut`}
                        title={`Reset ${action.label} shortcut`}
                        onClick={() => resetBinding(actionId)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-app-11 font-medium text-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/20"
                      >
                        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                        Reset
                      </button>
                    ) : null}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div className="flex justify-end border-t border-border px-3 py-3">
        <button
          type="button"
          disabled={!hasOverrides}
          onClick={resetAllBindings}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-app-12 font-medium text-muted transition-colors hover:border-border-strong hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/20 disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
          Reset All
        </button>
      </div>
    </div>
  );
}
