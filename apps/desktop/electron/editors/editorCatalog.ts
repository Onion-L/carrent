export interface EditorDescriptor {
  id: string;
  name: string;
  /** macOS .app bundle name inside an Applications directory. */
  appBundleName: string;
  /** Windows executable candidates; %VAR% segments expand from the environment. */
  windowsExecutables?: string[];
  /** Linux executable candidates; a ~/ prefix expands to the user's home. */
  linuxExecutables?: string[];
}

export const editorCatalog: EditorDescriptor[] = [
  {
    id: "cursor",
    name: "Cursor",
    appBundleName: "Cursor.app",
    windowsExecutables: ["%LOCALAPPDATA%\\Programs\\Cursor\\Cursor.exe"],
    linuxExecutables: ["/usr/bin/cursor", "/usr/local/bin/cursor", "~/.local/bin/cursor"],
  },
  {
    id: "vscode",
    name: "Visual Studio Code",
    appBundleName: "Visual Studio Code.app",
    windowsExecutables: [
      "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe",
      "%ProgramFiles%\\Microsoft VS Code\\Code.exe",
    ],
    linuxExecutables: ["/usr/bin/code", "/usr/local/bin/code", "/snap/bin/code"],
  },
  {
    id: "zed",
    name: "Zed",
    appBundleName: "Zed.app",
    windowsExecutables: ["%LOCALAPPDATA%\\Programs\\Zed\\Zed.exe"],
    linuxExecutables: ["~/.local/bin/zed", "/usr/bin/zed", "/usr/local/bin/zed"],
  },
  { id: "xcode", name: "Xcode", appBundleName: "Xcode.app" },
];

export function getEditorDescriptor(editorId: string): EditorDescriptor {
  const editor = editorCatalog.find((entry) => entry.id === editorId);

  if (editor == null) {
    throw new Error(`Unknown editor: ${editorId}`);
  }

  return editor;
}
