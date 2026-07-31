import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ForwardedRef,
} from "react";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  TextNode,
  type LexicalEditor,
  type LexicalNode,
  type RangeSelection,
} from "lexical";

import type { SkillRecord } from "../../../shared/skills";
import { $createComposerFileNode, $isComposerFileNode, ComposerFileNode } from "./ComposerFileNode";
import {
  $createComposerSkillNode,
  $isComposerSkillNode,
  ComposerSkillNode,
} from "./ComposerSkillNode";
import { parseFileReferenceSegments } from "./fileReferences";

export type ComposerEditorSnapshot = {
  content: string;
  skills: SkillRecord[];
  serializedState: string;
  cursor: number;
};

export type ComposerEditorTrigger = {
  start: number;
  end: number;
  query: string;
};

export type ComposerEditorHandle = {
  appendText: (text: string) => void;
  clear: () => void;
  focusEnd: () => void;
  insertSkill: (skill: SkillRecord) => void;
  removeSlashTrigger: () => void;
  replaceText: (text: string) => void;
  replaceTextPreservingSkills: (text: string) => void;
  restoreSkills: (skills: SkillRecord[]) => void;
};

type ComposerEditorProps = {
  activeDescendantId?: string;
  controlsId?: string;
  initialContent: string;
  initialSerializedState?: string;
  initialSkills: SkillRecord[];
  skills: SkillRecord[];
  menuItemCount: number;
  menuOpen: boolean;
  onMenuDismiss: () => void;
  onMenuMove: (direction: 1 | -1) => void;
  onMenuSelect: () => void;
  onPasteFiles: (files: FileList) => void;
  onSnapshot: (snapshot: ComposerEditorSnapshot) => void;
  onSubmit: () => void;
  onTriggerChange: (trigger: ComposerEditorTrigger | null) => void;
  resolvePastedContent: (text: string) => { skills: SkillRecord[]; text: string } | null;
  skillsDisabled: boolean;
};

type InternalTrigger = ComposerEditorTrigger & {
  nodeKey: string;
  nodeStart: number;
  nodeEnd: number;
};

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  function ComposerEditor(props, ref) {
    const initialConfig = useMemo(
      () => ({
        namespace: "carrent-composer",
        nodes: [ComposerFileNode, ComposerSkillNode],
        onError(error: Error) {
          throw error;
        },
        theme: {
          paragraph: "m-0",
        },
        editorState:
          getValidSerializedState(props.initialSerializedState) ??
          (() => initializeEditor(props.initialContent, props.initialSkills)),
      }),
      [],
    );

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <ComposerEditorBridge {...props} editorRef={ref} />
      </LexicalComposer>
    );
  },
);

function ComposerEditorBridge(
  props: ComposerEditorProps & {
    editorRef: ForwardedRef<ComposerEditorHandle>;
  },
) {
  const [editor] = useLexicalComposerContext();
  const focusedRef = useRef(false);
  const triggerRef = useRef<InternalTrigger | null>(null);

  const publishTrigger = useCallback(() => {
    const trigger = focusedRef.current ? getCurrentTrigger() : null;
    triggerRef.current = trigger;
    props.onTriggerChange(
      trigger ? { start: trigger.start, end: trigger.end, query: trigger.query } : null,
    );
  }, [props.onTriggerChange]);

  const insertSkill = useCallback(
    (skill: SkillRecord) => {
      editor.update(() => {
        const trigger = getCurrentTrigger();
        if (!trigger || !selectTrigger(trigger)) return;

        const alreadyInserted = collectComposerState().skills.some(
          (attached) => attached.path === skill.path,
        );
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        if (alreadyInserted) {
          selection.insertText(shouldInsertSpaceAfterTrigger(trigger) ? " " : "");
        } else {
          const nodes: LexicalNode[] = [$createComposerSkillNode(skill)];
          if (shouldInsertSpaceAfterTrigger(trigger)) {
            nodes.push($createTextNode(" "));
          }
          selection.insertNodes(nodes);
        }
      });
      requestAnimationFrame(() => editor.focus());
    },
    [editor],
  );

  const removeSlashTrigger = useCallback(() => {
    editor.update(() => {
      const trigger = getCurrentTrigger();
      if (!trigger || !selectTrigger(trigger)) return;
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText("");
    });
    requestAnimationFrame(() => editor.focus());
  }, [editor]);

  useImperativeHandle(
    props.editorRef,
    () => ({
      appendText(text) {
        editor.update(() => {
          const root = $getRoot();
          trimTrailingWhitespace(root);
          root.selectEnd();
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertText(text);
          }
        });
        requestAnimationFrame(() => editor.focus());
      },
      clear() {
        replaceEditorText(editor, "");
      },
      focusEnd() {
        editor.update(() => $getRoot().selectEnd());
        requestAnimationFrame(() => editor.focus());
      },
      insertSkill,
      removeSlashTrigger,
      replaceText(text) {
        replaceEditorText(editor, text);
        requestAnimationFrame(() => editor.focus());
      },
      replaceTextPreservingSkills(text) {
        editor.update(() => {
          const root = $getRoot();
          const skills = collectComposerState().skills;
          root.clear();
          const paragraph = $createParagraphNode();
          skills.forEach((skill) => paragraph.append($createComposerSkillNode(skill)));
          appendText(paragraph, text);
          root.append(paragraph);
          paragraph.selectEnd();
        });
        requestAnimationFrame(() => editor.focus());
      },
      restoreSkills(skills) {
        editor.update(() => {
          const state = collectComposerState();
          const missing = skills.filter(
            (skill) => !state.skills.some((attached) => attached.path === skill.path),
          );
          if (missing.length === 0) return;
          const first = $getRoot().getFirstChild();
          if (!$isElementNode(first)) return;
          missing
            .reverse()
            .forEach((skill) => first.splice(0, 0, [$createComposerSkillNode(skill)]));
        });
      },
    }),
    [editor, insertSkill, removeSlashTrigger],
  );

  return (
    <div
      data-composer-editor="true"
      className={`relative min-h-20 cursor-text whitespace-pre-wrap break-words text-app-15 leading-6 text-fg ${
        props.skillsDisabled ? "[&_[data-skill-marker='true']]:opacity-50" : ""
      }`}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        editor.update(() => $getRoot().selectEnd());
        editor.focus();
      }}
    >
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            role="textbox"
            aria-label="Message"
            aria-multiline="true"
            aria-placeholder="Message..."
            placeholder={() => null}
            aria-haspopup="listbox"
            aria-controls={props.menuOpen ? props.controlsId : undefined}
            aria-activedescendant={props.menuOpen ? props.activeDescendantId : undefined}
            data-composer-text="true"
            className="min-h-20 whitespace-pre-wrap break-words outline-none"
            onFocus={() => {
              focusedRef.current = true;
              editor.getEditorState().read(publishTrigger);
            }}
            onBlur={() => {
              focusedRef.current = false;
              triggerRef.current = null;
              props.onTriggerChange(null);
            }}
          />
        }
        placeholder={
          <div className="pointer-events-none absolute left-0 top-0 text-app-15 leading-6 text-subtle">
            Message...
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <OnChangePlugin
        onChange={(state) => {
          state.read(() => {
            const snapshot = collectComposerState();
            props.onSnapshot({
              ...snapshot,
              serializedState: JSON.stringify(state.toJSON()),
            });
            publishTrigger();
          });
        }}
      />
      <ComposerSkillReferencePlugin skills={props.skills} skillsDisabled={props.skillsDisabled} />
      <ComposerFileReferencePlugin />
      <ComposerCommandPlugin
        menuItemCount={props.menuItemCount}
        menuOpen={props.menuOpen}
        onMenuDismiss={props.onMenuDismiss}
        onMenuMove={props.onMenuMove}
        onMenuSelect={props.onMenuSelect}
        onPasteFiles={props.onPasteFiles}
        onSubmit={props.onSubmit}
        resolvePastedContent={props.resolvePastedContent}
      />
    </div>
  );
}

const SKILL_REFERENCE_PATTERN = /\[\$([^\]\n]+)\]\(([^)\n]+\/SKILL\.md)\)/gu;

function ComposerSkillReferencePlugin({
  skills,
  skillsDisabled,
}: Pick<ComposerEditorProps, "skills" | "skillsDisabled">) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (skillsDisabled) return;
    return editor.registerNodeTransform(TextNode, (node) => {
      const content = node.getTextContent();
      const replacements: LexicalNode[] = [];
      let lastIndex = 0;

      for (const match of content.matchAll(SKILL_REFERENCE_PATTERN)) {
        const skill = skills.find((item) => item.name === match[1] && item.path === match[2]);
        if (!skill) continue;
        const index = match.index ?? 0;
        if (index > lastIndex) replacements.push($createTextNode(content.slice(lastIndex, index)));
        replacements.push($createComposerSkillNode(skill));
        lastIndex = index + match[0].length;
      }

      if (lastIndex === 0) return;
      if (lastIndex < content.length) replacements.push($createTextNode(content.slice(lastIndex)));
      replaceTextNode(node, replacements);
    });
  }, [editor, skills, skillsDisabled]);

  return null;
}

function ComposerFileReferencePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerNodeTransform(TextNode, (node) => {
      const segments = parseFileReferenceSegments(node.getTextContent());
      if (!segments.some((segment) => segment.type === "file")) return;

      const replacements: LexicalNode[] = [];
      for (const segment of segments) {
        if (segment.type === "file") {
          replacements.push($createComposerFileNode(segment.label, segment.path));
        } else if (segment.content) {
          replacements.push($createTextNode(segment.content));
        }
      }
      replaceTextNode(node, replacements);
    });
  }, [editor]);

  return null;
}

function replaceTextNode(node: TextNode, replacements: LexicalNode[]) {
  const first = replacements[0];
  if (!first) return;
  const selection = $getSelection();
  const restoreSelectionAfter =
    $isRangeSelection(selection) &&
    selection.isCollapsed() &&
    selection.anchor.key === node.getKey() &&
    selection.anchor.offset === node.getTextContentSize();

  node.replace(first);
  let last = first;
  for (const replacement of replacements.slice(1)) {
    last.insertAfter(replacement);
    last = replacement;
  }
  if (restoreSelectionAfter) last.selectNext();
}

function ComposerCommandPlugin(
  props: Pick<
    ComposerEditorProps,
    | "menuItemCount"
    | "menuOpen"
    | "onMenuDismiss"
    | "onMenuMove"
    | "onMenuSelect"
    | "onPasteFiles"
    | "onSubmit"
    | "resolvePastedContent"
  >,
) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return mergeUnregister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (!props.menuOpen || isComposing(event)) return false;
          event.preventDefault();
          props.onMenuMove(1);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (event) => {
          if (!props.menuOpen || isComposing(event)) return false;
          event.preventDefault();
          props.onMenuMove(-1);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (event?.shiftKey || isComposing(event)) return false;
          event?.preventDefault();
          if (props.menuOpen && props.menuItemCount > 0) {
            props.onMenuSelect();
          } else if (!props.menuOpen) {
            props.onSubmit();
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (!props.menuOpen || props.menuItemCount === 0 || isComposing(event)) return false;
          event.preventDefault();
          props.onMenuSelect();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          if (!props.menuOpen || isComposing(event)) return false;
          event.preventDefault();
          props.onMenuDismiss();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => removeAdjacentReference("backward", event),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        (event) => removeAdjacentReference("forward", event),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          const data = "clipboardData" in event ? event.clipboardData : null;
          if (!data) return false;
          if (data.files.length > 0) {
            event.preventDefault();
            props.onPasteFiles(data.files);
            return true;
          }
          const text = data.getData("text/plain");
          const pasted = props.resolvePastedContent(text);
          if (!pasted) return false;

          event.preventDefault();
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return true;
          const nodes: LexicalNode[] = pasted.skills.map($createComposerSkillNode);
          if (pasted.text) nodes.push($createTextNode(pasted.text));
          selection.insertNodes(nodes);
          return true;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );
  }, [editor, props]);

  return null;
}

function initializeEditor(content: string, skills: SkillRecord[]) {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  for (const skill of skills) paragraph.append($createComposerSkillNode(skill));
  appendText(paragraph, content);
  root.append(paragraph);
}

function replaceEditorText(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const paragraph = $createParagraphNode();
    appendText(paragraph, text);
    root.append(paragraph);
    paragraph.selectEnd();
  });
}

function appendText(parent: ReturnType<typeof $createParagraphNode>, text: string) {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  lines.forEach((line, index) => {
    if (index > 0) parent.append($createLineBreakNode());
    for (const segment of parseFileReferenceSegments(line)) {
      if (segment.type === "file") {
        parent.append($createComposerFileNode(segment.label, segment.path));
      } else if (segment.content) {
        parent.append($createTextNode(segment.content));
      }
    }
  });
}

function trimTrailingWhitespace(root: ReturnType<typeof $getRoot>) {
  const leaves: LexicalNode[] = [];
  const collectLeaves = (node: LexicalNode) => {
    if ($isElementNode(node)) {
      node.getChildren().forEach(collectLeaves);
    } else {
      leaves.push(node);
    }
  };
  root.getChildren().forEach(collectLeaves);

  for (let index = leaves.length - 1; index >= 0; index -= 1) {
    const node = leaves[index]!;
    if ($isComposerSkillNode(node)) continue;
    if ($isLineBreakNode(node)) {
      node.remove();
      continue;
    }
    if (!$isTextNode(node)) return;

    const text = node.getTextContent();
    const trimmed = text.replace(/\s+$/u, "");
    if (trimmed === text) return;
    if (trimmed) {
      node.setTextContent(trimmed);
      return;
    }
    node.remove();
  }
}

function getValidSerializedState(value?: string) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { root?: unknown };
    return parsed.root ? value : null;
  } catch {
    return null;
  }
}

function collectComposerState(): Omit<ComposerEditorSnapshot, "serializedState"> {
  const root = $getRoot();
  const skills: SkillRecord[] = [];
  const seenPaths = new Set<string>();
  let content = "";
  let cursor = 0;
  const selection = $getSelection();
  const anchor = $isRangeSelection(selection) && selection.isCollapsed() ? selection.anchor : null;

  const visit = (node: LexicalNode) => {
    if ($isComposerSkillNode(node)) {
      const skill = node.getSkill();
      if (!seenPaths.has(skill.path)) {
        seenPaths.add(skill.path);
        skills.push(skill);
      }
      return;
    }
    if ($isComposerFileNode(node)) {
      content += node.getTextContent();
      return;
    }
    if ($isTextNode(node)) {
      if (anchor?.key === node.getKey() && anchor.type === "text") {
        cursor = content.length + anchor.offset;
      }
      content += node.getTextContent();
      return;
    }
    if ($isLineBreakNode(node)) {
      content += "\n";
      return;
    }
    if ($isElementNode(node)) {
      node.getChildren().forEach(visit);
    }
  };

  root.getChildren().forEach((node, index) => {
    if (index > 0) content += "\n";
    visit(node);
  });
  if (anchor?.type === "element" && anchor.key === root.getKey()) cursor = content.length;
  return { content, skills, cursor };
}

function getCurrentTrigger(): InternalTrigger | null {
  const selection = $getSelection();
  if (
    !$isRangeSelection(selection) ||
    !selection.isCollapsed() ||
    selection.anchor.type !== "text"
  ) {
    return null;
  }
  const node = $getNodeByKey(selection.anchor.key);
  if (!$isTextNode(node)) return null;
  const cursor = selection.anchor.offset;
  const text = node.getTextContent();
  const left = text.slice(0, cursor);
  const tokenStart =
    Math.max(left.lastIndexOf(" "), left.lastIndexOf("\n"), left.lastIndexOf("\t")) + 1;
  const token = left.slice(tokenStart);
  if (!token.startsWith("/") || token.slice(1).includes("/")) return null;

  const snapshot = collectComposerState();
  return {
    start: snapshot.cursor - (cursor - tokenStart),
    end: snapshot.cursor,
    query: token.slice(1),
    nodeKey: node.getKey(),
    nodeStart: tokenStart,
    nodeEnd: cursor,
  };
}

function selectTrigger(trigger: InternalTrigger) {
  const node = $getNodeByKey(trigger.nodeKey);
  if (!$isTextNode(node)) return false;
  const expected = `/${trigger.query}`;
  if (node.getTextContent().slice(trigger.nodeStart, trigger.nodeEnd) !== expected) return false;
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  selection.setTextNodeRange(node, trigger.nodeStart, node, trigger.nodeEnd);
  return true;
}

function shouldInsertSpaceAfterTrigger(trigger: InternalTrigger) {
  const node = $getNodeByKey(trigger.nodeKey);
  if (!$isTextNode(node)) return true;
  return !/^\s/u.test(node.getTextContent().slice(trigger.nodeEnd));
}

function removeAdjacentReference(direction: "backward" | "forward", event: KeyboardEvent) {
  if (isComposing(event)) return false;
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const reference = getAdjacentReference(selection, direction);
  if (!reference) return false;
  event.preventDefault();
  reference.remove();
  return true;
}

function getAdjacentReference(selection: RangeSelection, direction: "backward" | "forward") {
  const anchor = selection.anchor;
  const node = $getNodeByKey(anchor.key);
  if (!node) return null;
  if ($isTextNode(node)) {
    if (direction === "backward" && anchor.offset === 0) {
      const previous = node.getPreviousSibling();
      return isComposerReferenceNode(previous) ? previous : null;
    }
    if (direction === "forward" && anchor.offset === node.getTextContentSize()) {
      const next = node.getNextSibling();
      return isComposerReferenceNode(next) ? next : null;
    }
    return null;
  }
  if ($isElementNode(node) && anchor.type === "element") {
    const index = direction === "backward" ? anchor.offset - 1 : anchor.offset;
    const child = node.getChildAtIndex(index);
    return isComposerReferenceNode(child) ? child : null;
  }
  return null;
}

function isComposerReferenceNode(node: unknown) {
  return $isComposerSkillNode(node) || $isComposerFileNode(node);
}

function isComposing(event: KeyboardEvent | null | undefined) {
  return !!event && (event.isComposing || event.keyCode === 229);
}

function mergeUnregister(...unregister: Array<() => void>) {
  return () => unregister.forEach((callback) => callback());
}
