import { realpath } from "node:fs/promises";

type DirectoryDialogResult = {
  canceled: boolean;
  filePaths: string[];
};

type IpcMainLike = {
  handle: (channel: string, listener: () => Promise<unknown> | unknown) => void;
};

export function registerDialogIpc(
  ipcMainLike: IpcMainLike,
  showOpenDirectory: () => Promise<DirectoryDialogResult>,
  canonicalizePath: (filePath: string) => Promise<string> = realpath,
) {
  ipcMainLike.handle("dialog:open-directory", async () => {
    const result = await showOpenDirectory();
    return {
      ...result,
      filePaths: await Promise.all(result.filePaths.map((filePath) => canonicalizePath(filePath))),
    };
  });
}
