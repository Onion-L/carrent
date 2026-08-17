import { Code2 } from "lucide-react";

import cursorDarkIcon from "../assets/editors/cursor-dark.png";
import cursorLightIcon from "../assets/editors/cursor-light.png";
import vscodeIcon from "../assets/editors/vscode.png";
import xcodeIcon from "../assets/editors/xcode.png";
import zedDarkIcon from "../assets/editors/zed-dark.png";
import zedLightIcon from "../assets/editors/zed-light.png";

const EDITOR_ICON_CLASS = "h-3.5 w-3.5 shrink-0 object-contain text-muted";

const EDITOR_ICONS: Record<string, { light: string; dark?: string }> = {
  cursor: { light: cursorLightIcon, dark: cursorDarkIcon },
  vscode: { light: vscodeIcon },
  zed: { light: zedLightIcon, dark: zedDarkIcon },
  xcode: { light: xcodeIcon },
};

export function EditorIcon({
  editorId,
  isDark,
  className = EDITOR_ICON_CLASS,
}: {
  editorId: string;
  isDark: boolean;
  className?: string;
}) {
  const icons = EDITOR_ICONS[editorId];
  if (!icons) return <Code2 className={className} />;

  return (
    <img
      src={isDark ? (icons.dark ?? icons.light) : icons.light}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
    />
  );
}
