import type { KeybindingInput } from "../src/shared/keybindings";

type BeforeInput = {
  type: string;
  key: string;
  code?: string;
  meta: boolean;
  control: boolean;
  alt: boolean;
  shift: boolean;
};

type PreventableEvent = {
  preventDefault: () => void;
};

export function createKeybindingRecordingController() {
  const recordingContentsIds = new Set<number>();
  const pendingCmdTabContentsIds = new Set<number>();

  return {
    setRecording(contentsId: number, active: boolean) {
      if (active) recordingContentsIds.add(contentsId);
      else {
        recordingContentsIds.delete(contentsId);
        pendingCmdTabContentsIds.delete(contentsId);
      }
    },
    clear(contentsId: number) {
      recordingContentsIds.delete(contentsId);
      pendingCmdTabContentsIds.delete(contentsId);
    },
    handleBeforeInput(
      contentsId: number,
      event: PreventableEvent,
      input: BeforeInput,
      send: (input: KeybindingInput) => void,
    ) {
      if (!recordingContentsIds.has(contentsId)) return false;
      if (
        input.type === "keyDown" &&
        input.key === "Meta" &&
        input.meta &&
        !input.control &&
        !input.alt &&
        !input.shift
      ) {
        pendingCmdTabContentsIds.add(contentsId);
      } else {
        pendingCmdTabContentsIds.delete(contentsId);
      }
      const modifiers = {
        metaKey: input.meta,
        ctrlKey: input.control,
        altKey: input.alt,
        shiftKey: input.shift,
      };
      if (input.type !== "keyDown") return false;
      event.preventDefault();
      send({
        key: input.key,
        ...(input.code ? { code: input.code } : {}),
        ...modifiers,
      });
      return true;
    },
    handleWindowBlur(contentsId: number, send: (input: KeybindingInput) => void) {
      if (!recordingContentsIds.has(contentsId) || !pendingCmdTabContentsIds.delete(contentsId)) {
        return false;
      }
      send({ key: "Tab", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false });
      return true;
    },
  };
}
