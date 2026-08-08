export interface DetectedEditor {
  id: string;
  name: string;
  appPath: string;
}

export interface EditorsApi {
  list: () => Promise<DetectedEditor[]>;
  open: (editorId: string, workingDirectory: string) => Promise<string>;
}
