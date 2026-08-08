export interface EditorDescriptor {
  id: string;
  name: string;
  appBundleName: string;
}

export const editorCatalog: EditorDescriptor[] = [
  { id: "cursor", name: "Cursor", appBundleName: "Cursor.app" },
  {
    id: "vscode",
    name: "Visual Studio Code",
    appBundleName: "Visual Studio Code.app",
  },
  { id: "zed", name: "Zed", appBundleName: "Zed.app" },
  { id: "xcode", name: "Xcode", appBundleName: "Xcode.app" },
];

export function getEditorDescriptor(editorId: string): EditorDescriptor {
  const editor = editorCatalog.find((entry) => entry.id === editorId);

  if (editor == null) {
    throw new Error(`Unknown editor: ${editorId}`);
  }

  return editor;
}
