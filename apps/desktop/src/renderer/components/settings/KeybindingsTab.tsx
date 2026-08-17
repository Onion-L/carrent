import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  ACTION_IDS,
  type ActionId,
  type KeyBinding,
  type KeybindingRecordingInput,
} from "../../../shared/keybindings";
import { useSettings } from "../../context/SettingsContext";
import {
  detectConflict,
  formatKeybinding,
  isReservedKey,
  normalizeModifiers,
  prepareKeybindingUpdate,
  resolveKeybinding,
} from "../../lib/keybindings";

const ACTION_LABELS: Record<ActionId, string> = {
  "search-threads": "Search Threads",
  "toggle-terminal": "Toggle Terminal",
  "zoom-in": "Zoom In",
  "zoom-out": "Zoom Out",
  "reset-zoom": "Reset Zoom",
};

export function KeybindingsTab() {
  const { keybindingOverrides, updateSetting } = useSettings();
  const [recordingActionId, setRecordingActionId] = useState<ActionId | null>(null);
  const [candidate, setCandidate] = useState<KeyBinding | null>(null);
  const recorderRef = useRef<HTMLButtonElement>(null);

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

  const handleRecordedInput = (input: KeybindingRecordingInput, actionId: ActionId) => {
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
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full table-fixed border-collapse text-left">
        <thead className="bg-surface-raised text-app-11 font-medium text-subtle">
          <tr className="border-b border-border">
            <th className="w-1/2 px-4 py-2.5 font-medium">Action</th>
            <th className="px-4 py-2.5 font-medium">Shortcut</th>
            <th className="w-12 px-2 py-2.5 font-medium">
              <span className="sr-only">Reset</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ACTION_IDS.map((actionId) => {
            const binding = resolveKeybinding(actionId, keybindingOverrides);
            const isRecording = recordingActionId === actionId;
            const reserved =
              isRecording && candidate ? isReservedKey(candidate.key, candidate.modifiers) : null;
            const conflictActionId =
              isRecording && candidate
                ? detectConflict(candidate.key, candidate.modifiers, actionId, keybindingOverrides)
                : null;
            const feedbackId = `keybinding-feedback-${actionId}`;

            return (
              <tr key={actionId} className="align-top">
                <td className="px-4 py-3.5 text-app-13 text-fg">{ACTION_LABELS[actionId]}</td>
                <td
                  className="cursor-pointer px-4 py-3"
                  onClick={() => {
                    if (isRecording) return;
                    setRecordingActionId(actionId);
                    setCandidate(null);
                  }}
                >
                  <div
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        stopRecording();
                      }
                    }}
                  >
                    <button
                      ref={isRecording ? recorderRef : undefined}
                      type="button"
                      data-keybinding-recorder={isRecording ? "true" : undefined}
                      aria-label={`${ACTION_LABELS[actionId]} shortcut`}
                      aria-describedby={isRecording && candidate ? feedbackId : undefined}
                      onKeyDown={
                        isRecording ? (event) => handleRecorderKeyDown(event, actionId) : undefined
                      }
                      className={`inline-flex min-h-8 w-full max-w-[220px] items-center justify-center rounded-md border px-2.5 font-mono text-app-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/20 ${
                        isRecording
                          ? "border-border-strong bg-surface-hover text-fg"
                          : "border-border bg-surface text-fg shadow-[0_1px_0_rgb(var(--color-border-strong)/0.35)] hover:border-border-strong hover:bg-surface-hover"
                      }`}
                    >
                      {isRecording
                        ? candidate
                          ? formatKeybinding(candidate)
                          : "Press keys..."
                        : binding
                          ? formatKeybinding(binding)
                          : "Unassigned"}
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
                                <span>⚠️ Already bound to {ACTION_LABELS[conflictActionId]}</span>
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
                <td className="w-12 px-2 py-3.5" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
