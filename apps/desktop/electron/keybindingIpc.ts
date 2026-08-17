type IpcMainLike = {
  on: (
    channel: string,
    listener: (event: { sender: { id: number } }, active: unknown) => void,
  ) => void;
};

type KeybindingRecordingLike = {
  setRecording: (contentsId: number, active: boolean) => void;
};

export function registerKeybindingIpc(ipcMain: IpcMainLike, recording: KeybindingRecordingLike) {
  ipcMain.on("keybindings:set-recording", (event, active) => {
    if (typeof active !== "boolean") return;
    recording.setRecording(event.sender.id, active);
  });
}
