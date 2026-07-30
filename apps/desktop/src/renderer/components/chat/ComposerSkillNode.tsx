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
        className="mr-2 inline-flex h-6 max-w-full items-center gap-2 align-top text-app-14 font-medium leading-6 text-skill-reference"
      >
        <Box className="h-4 w-4 shrink-0" strokeWidth={2} />
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

function formatSkillLabel(name: string) {
  const [namespace, ...rest] = name.split(":");
  if (rest.length === 0) {
    return titleCaseSkillName(namespace);
  }
  return `${titleCaseSkillName(namespace)}: ${titleCaseSkillName(rest.join(":"))}`;
}

function titleCaseSkillName(name: string) {
  return name
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => {
      if (part.toLowerCase() === "ui") return "UI";
      if (part.toLowerCase() === "ux") return "UX";
      if (part.toLowerCase() === "pdf") return "PDF";
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}
