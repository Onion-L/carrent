import { Box } from "lucide-react";
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

import type { SkillRecord } from "../../../shared/skills";
import { formatSkillLabel } from "./skillLabel";

export type SerializedComposerSkillNode = Spread<
  {
    name: string;
    path: string;
  },
  SerializedLexicalNode
>;

export class ComposerSkillNode extends DecoratorNode<ReactNode> {
  __name: string;
  __path: string;

  static getType() {
    return "composer-skill";
  }

  static clone(node: ComposerSkillNode) {
    return new ComposerSkillNode(node.__name, node.__path, node.__key);
  }

  static importJSON(node: SerializedComposerSkillNode) {
    return $createComposerSkillNode({
      name: node.name,
      path: node.path,
      description: "",
      source: "agents",
    });
  }

  constructor(name: string, path: string, key?: NodeKey) {
    super(key);
    this.__name = name;
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

  exportJSON(): SerializedComposerSkillNode {
    return {
      name: this.__name,
      path: this.__path,
      type: "composer-skill",
      version: 1,
    };
  }

  getTextContent() {
    return `[$${this.__name}](${this.__path})`;
  }

  isInline() {
    return true;
  }

  isKeyboardSelectable() {
    return false;
  }

  getSkill(): SkillRecord {
    return {
      name: this.__name,
      path: this.__path,
      description: "",
      source: "agents",
    };
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig) {
    return (
      <span
        title={this.__path}
        data-skill-marker="true"
        contentEditable={false}
        className="mr-2 inline-flex h-[1.5em] max-w-full items-center gap-[0.4em] align-top font-medium leading-[1.5em] text-skill-reference"
      >
        <Box className="h-[1em] w-[1em] shrink-0" strokeWidth={2} />
        <span className="truncate">{formatSkillLabel(this.__name)}</span>
      </span>
    );
  }
}

export function $createComposerSkillNode(skill: SkillRecord) {
  return $applyNodeReplacement(new ComposerSkillNode(skill.name, skill.path));
}

export function $isComposerSkillNode(node: unknown): node is ComposerSkillNode {
  return node instanceof ComposerSkillNode;
}
