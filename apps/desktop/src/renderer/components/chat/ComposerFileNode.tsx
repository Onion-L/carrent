import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

export type SerializedComposerFileNode = Spread<
  {
    label: string;
    path: string;
  },
  SerializedLexicalNode
>;

export class ComposerFileNode extends DecoratorNode<ReactNode> {
  __label: string;
  __path: string;

  static getType() {
    return "composer-file";
  }

  static clone(node: ComposerFileNode) {
    return new ComposerFileNode(node.__label, node.__path, node.__key);
  }

  static importJSON(node: SerializedComposerFileNode) {
    return $createComposerFileNode(node.label, node.path);
  }

  constructor(label: string, path: string, key?: NodeKey) {
    super(key);
    this.__label = label;
    this.__path = path;
  }

  createDOM(_config: EditorConfig) {
    const element = document.createElement("span");
    element.style.display = "inline";
    return element;
  }

  updateDOM() {
    return false;
  }

  exportJSON(): SerializedComposerFileNode {
    return {
      label: this.__label,
      path: this.__path,
      type: "composer-file",
      version: 1,
    };
  }

  getTextContent() {
    return `[${this.__label}](${this.__path})`;
  }

  isInline() {
    return true;
  }

  isKeyboardSelectable() {
    return false;
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig) {
    return (
      <span
        title={this.__path}
        data-file-marker="true"
        contentEditable={false}
        className="mx-0.5 inline-flex h-6 max-w-full items-center gap-1 align-top text-app-14 font-medium leading-6 text-skill-reference"
      >
        <FileText className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="truncate">{this.__label}</span>
      </span>
    );
  }
}

export function $createComposerFileNode(label: string, path: string) {
  return $applyNodeReplacement(new ComposerFileNode(label, path));
}

export function $isComposerFileNode(node: unknown): node is ComposerFileNode {
  return node instanceof ComposerFileNode;
}
