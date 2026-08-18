import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-python";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function normalizeMathDelimiters(markdown: string) {
  return markdown
    .replace(/\\\[/g, () => "\n$$\n")
    .replace(/\\\]/g, () => "\n$$\n")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");
}

// Module-level constants keep plugin and component configuration referentially
// stable across renders, so an unchanged answer is never re-parsed.
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

export type MarkdownLinkRender = (props: {
  children: ReactNode;
  href?: string;
}) => ReactNode | undefined;

export type MarkdownVariant = "assistant" | "user";

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "bash",
  css: "css",
  html: "markup",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  python: "python",
  py: "python",
  shell: "bash",
  sh: "bash",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  xml: "markup",
  yaml: "yaml",
  yml: "yaml",
};

function codeTextContent(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(codeTextContent).join("");
  return "";
}

function highlightCode(children: ReactNode, className?: string) {
  const languageMatch = className?.match(/(?:^|\s)language-([\w-]+)/u);
  if (!languageMatch) return null;

  const language = LANGUAGE_ALIASES[languageMatch[1].toLowerCase()];
  const grammar = language === undefined ? undefined : Prism.languages[language];
  if (grammar === undefined) return null;

  return Prism.highlight(codeTextContent(children), grammar, language);
}

const variantStyles = {
  assistant: {
    text: "text-fg",
    muted: "text-muted",
    border: "border-border",
    codeBackground: "bg-code-bg",
    body: "text-app-15",
    paragraph: "",
    wrapper: "",
  },
  user: {
    text: "text-user-bubble-fg",
    muted: "text-user-bubble-fg/75",
    border: "border-user-bubble-fg/25",
    codeBackground: "bg-user-bubble-fg/10",
    body: "text-app-14",
    paragraph: "whitespace-pre-wrap",
    wrapper: "space-y-2 break-words text-app-14 leading-relaxed text-user-bubble-fg",
  },
} as const satisfies Record<MarkdownVariant, Record<string, string>>;

function createComponents(
  variant: MarkdownVariant,
  renderLink?: MarkdownLinkRender,
  onLinkClick?: (href: string) => boolean,
): Components {
  const styles = variantStyles[variant];

  return {
    p: ({ children }) => (
      <p className={`${styles.body} ${styles.paragraph} leading-7 ${styles.text}`}>{children}</p>
    ),
    h1: ({ children }) => (
      <h1 className={`text-app-22 font-semibold leading-tight ${styles.text}`}>{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className={`text-app-18 font-semibold leading-snug ${styles.text}`}>{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className={`text-app-16 font-semibold leading-snug ${styles.text}`}>{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className={`text-app-15 font-semibold leading-snug ${styles.text}`}>{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className={`text-app-14 font-semibold leading-snug ${styles.text}`}>{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className={`text-app-13 font-semibold leading-snug ${styles.text}`}>{children}</h6>
    ),
    ul: ({ children }) => (
      <ul className={`list-disc space-y-1 pl-5 ${styles.body} leading-7 ${styles.text}`}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className={`list-decimal space-y-1 pl-5 ${styles.body} leading-7 ${styles.text}`}>
        {children}
      </ol>
    ),
    li: ({ children }) => <li>{children}</li>,
    a: ({ children, href }) => {
      const customLink = renderLink?.({ children, href });
      if (customLink !== undefined) return customLink;

      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={
            onLinkClick === undefined || href === undefined
              ? undefined
              : (event) => {
                  if (onLinkClick(href)) event.preventDefault();
                }
          }
          className="text-brand underline underline-offset-2"
        >
          {children}
        </a>
      );
    },
    strong: ({ children }) => (
      <strong className={`font-semibold ${styles.text}`}>{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    code: ({ children, className }) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code className={`font-code rounded px-1 py-0.5 ${styles.codeBackground} ${styles.text}`}>
            {children}
          </code>
        );
      }

      const highlightedCode = highlightCode(children, className);
      return highlightedCode === null ? (
        <code className={`font-code ${styles.text}`}>{children}</code>
      ) : (
        <code
          className={`font-code markdown-code-highlight ${styles.text}`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      );
    },
    pre: ({ children }) => (
      <pre
        className={`font-code overflow-x-auto rounded-lg p-3 leading-relaxed ${styles.codeBackground} ${styles.text}`}
      >
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className={`border-l-2 pl-3 ${styles.border} ${styles.muted}`}>
        {children}
      </blockquote>
    ),
    hr: () => <hr className={styles.border} />,
    ...(variant === "user"
      ? {
          table: ({ children }: { children?: ReactNode }) => (
            <div className="max-w-full overflow-x-auto">
              <table className={`min-w-full border-collapse ${styles.body} ${styles.text}`}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children }: { children?: ReactNode }) => (
            <thead className={styles.codeBackground}>{children}</thead>
          ),
          tbody: ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>,
          tr: ({ children }: { children?: ReactNode }) => (
            <tr className={`border-b ${styles.border}`}>{children}</tr>
          ),
          th: ({ children }: { children?: ReactNode }) => (
            <th className="px-2 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }: { children?: ReactNode }) => (
            <td className="px-2 py-1.5 align-top">{children}</td>
          ),
        }
      : {}),
    ...(variant === "user"
      ? {
          img: ({ alt, src }: { alt?: string; src?: string }) => (
            <span className={`font-code ${styles.muted}`}>{alt || src || "image"}</span>
          ),
        }
      : {}),
  };
}

const assistantComponents = createComponents("assistant");

export const MarkdownContent = memo(function MarkdownContent({
  children,
  variant = "assistant",
  renderLink,
  onLinkClick,
}: {
  children: string;
  variant?: MarkdownVariant;
  renderLink?: MarkdownLinkRender;
  onLinkClick?: (href: string) => boolean;
}) {
  const content = normalizeMathDelimiters(children);
  const markdownComponents = useMemo<Components>(() => {
    if (variant === "assistant" && renderLink === undefined && onLinkClick === undefined) {
      return assistantComponents;
    }
    return createComponents(variant, renderLink, onLinkClick);
  }, [onLinkClick, renderLink, variant]);

  const markdown = (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );

  return variant === "user" ? (
    <div className={variantStyles.user.wrapper}>{markdown}</div>
  ) : (
    markdown
  );
});
