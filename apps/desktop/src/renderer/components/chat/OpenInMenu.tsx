import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, SquarePen } from "lucide-react";

import { resolveDefaultEditor, type DetectedEditor } from "../../../shared/editors";
import finderIcon from "../../assets/editors/finder.png";
import { EditorIcon } from "../EditorIcon";
import { useSettings } from "../../context/SettingsContext";
import { useKeybinding } from "../../hooks/useKeybinding";
import { ContextMenuShell } from "../workspace/ContextMenu";
import { useToast } from "../toast/ToastContext";

function OpenMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-app-13 text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{label}</span>
    </button>
  );
}

export function OpenInMenu({
  workingDirectory,
  disabled,
}: {
  workingDirectory: string;
  disabled?: boolean;
}) {
  const { showToast } = useToast();
  const { theme, defaultEditorId } = useSettings();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const isDark = theme === "dark" || (theme === "system" && systemIsDark);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemIsDark(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, [theme]);

  const closeMenu = useCallback((returnFocus?: boolean) => {
    setAnchor(null);
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (disabled) {
      closeMenu();
    }
  }, [disabled, closeMenu]);

  useEffect(() => {
    const editorsApi = window.carrent.editors;
    if (typeof editorsApi?.list !== "function") return;
    editorsApi
      .list()
      .then(setEditors)
      .catch(() => showToast("Installed editors could not be detected.", "error"));
  }, [showToast]);

  const handleTriggerClick = () => {
    if (anchor) {
      closeMenu();
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    setAnchor({
      x: rect?.right ?? 0,
      y: (rect?.bottom ?? 0) + 4,
    });
  };

  const handleOpenInEditor = async (editor: DetectedEditor) => {
    closeMenu();
    const editorsApi = window.carrent.editors;
    if (typeof editorsApi?.open !== "function") {
      showToast("Open in editor support is not loaded. Restart Carrent and try again.", "error");
      return;
    }

    try {
      const error = await editorsApi.open(editor.id, workingDirectory);
      if (error) showToast(error, "error");
    } catch {
      showToast(`Working directory could not be opened in ${editor.name}.`, "error");
    }
  };

  const handleOpenInFinder = async () => {
    closeMenu();
    try {
      const result = await window.carrent.shell.revealPath(workingDirectory);
      if (!result.revealed) showToast("Working directory could not be found.", "error");
    } catch {
      showToast("Working directory could not be opened in Finder.", "error");
    }
  };

  const handleOpenDefault = async () => {
    closeMenu();
    if (!defaultEditor) {
      showToast("No installed editors were detected.", "error");
      return;
    }
    await handleOpenInEditor(defaultEditor);
  };

  const defaultEditor = resolveDefaultEditor(editors, defaultEditorId);
  useKeybinding("open-default-editor", () => {
    if (!disabled) void handleOpenDefault();
  });

  return (
    <>
      <div
        className={`order-first flex h-8 w-[52px] items-stretch overflow-hidden rounded-md border border-border bg-bg transition ${
          disabled ? "cursor-not-allowed text-subtle" : anchor ? "text-fg" : "text-muted"
        }`}
      >
        <button
          type="button"
          aria-label="Open working directory in default editor"
          title={defaultEditor ? `Open in ${defaultEditor.name}` : "Open in editor"}
          disabled={disabled}
          onClick={() => void handleOpenDefault()}
          className="flex min-w-0 flex-1 items-center justify-center px-1 text-left transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-subtle"
        >
          {defaultEditor ? (
            <>
              <EditorIcon editorId={defaultEditor.id} isDark={isDark} />
            </>
          ) : (
            <SquarePen className="h-4 w-4" />
          )}
        </button>
        <div aria-hidden="true" className="my-1.5 w-px bg-border" />
        <button
          ref={triggerRef}
          type="button"
          aria-label="Open working directory in editor or Finder"
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          title="Open in"
          disabled={disabled}
          onClick={handleTriggerClick}
          className="flex w-6 items-center justify-center transition hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-subtle"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
      {anchor ? (
        <ContextMenuShell anchor={anchor} onClose={closeMenu} align="end">
          <div
            role="menu"
            aria-label="Open working directory in"
            className="w-[180px] rounded-lg border border-border-strong bg-surface p-1 shadow-xl"
          >
            {editors.map((editor) => (
              <OpenMenuItem
                key={editor.id}
                icon={
                  <EditorIcon
                    editorId={editor.id}
                    isDark={isDark}
                    className="h-4 w-4 shrink-0 object-contain text-muted"
                  />
                }
                label={editor.name}
                onClick={() => void handleOpenInEditor(editor)}
              />
            ))}
            <OpenMenuItem
              icon={
                <img
                  src={finderIcon}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="h-4 w-4 shrink-0 object-contain"
                />
              }
              label="Finder"
              onClick={() => void handleOpenInFinder()}
            />
          </div>
        </ContextMenuShell>
      ) : null}
    </>
  );
}
