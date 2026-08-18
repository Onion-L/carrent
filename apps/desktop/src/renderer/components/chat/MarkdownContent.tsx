import { isValidElement, memo, useMemo, type CSSProperties, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { useSettings } from "../../context/SettingsContext";
import { highlightCodeBlock } from "../../lib/codeHighlight";

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

const LANGUAGE_CLASS_PATTERN = /(?:^|\s)language-([\w-]+)/u;

function codeTextContent(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(codeTextContent).join("");
  return "";
}

function fencedCodeDetails(children: ReactNode): { code: string; language: string } | null {
  if (!isValidElement(children)) return null;
  const props = children.props as { className?: string; children?: ReactNode };
  const languageMatch = props.className?.match(LANGUAGE_CLASS_PATTERN);
  if (!languageMatch) return null;
  const code = codeTextContent(props.children);
  if (code === "") return null;
  return { code, language: languageMatch[1] };
}

/**
 * Fenced code blocks highlight through Shiki with a light/dark token pair;
 * index.css resolves the active variant from the app's data-theme. Highlight
 * failures (unknown language) fall back to the plain pre below. Reads the
 * theme from settings directly so only pre blocks re-render when it changes.
 */
function MarkdownPre({ children, variant }: { children: ReactNode; variant: MarkdownVariant }) {
  const styles = variantStyles[variant];
  const { codeHighlightTheme } = useSettings();
  const details = fencedCodeDetails(children);
  const highlighted =
    details === null ? null : highlightCodeBlock(details.code, details.language, codeHighlightTheme);

  if (highlighted === null) {
    return (
      <pre
        className={`font-code overflow-x-auto rounded-lg p-3 leading-relaxed ${styles.codeBackground} ${styles.text}`}
      >
        {children}
      </pre>
    );
  }

  return (
    <pre
      className="font-code markdown-code-block overflow-x-auto rounded-lg p-3 leading-relaxed"
      style={
        {
          "--shk-bg-light": highlighted.bgLight,
          "--shk-bg-dark": highlighted.bgDark,
        } as CSSProperties
      }
    >
      <code
        className="font-code markdown-code-highlight"
        style={
          {
            "--shk-fg-light": highlighted.fgLight,
            "--shk-fg-dark": highlighted.fgDark,
          } as CSSProperties
        }
        dangerouslySetInnerHTML={{ __html: highlighted.html }}
      />
    </pre>
  );
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

      // Fenced code renders through MarkdownPre; this path only draws the
      // plain fallback when highlighting is unavailable.
      return <code className={`font-code ${styles.text}`}>{children}</code>;
    },
    pre: ({ children }) => (
      <MarkdownPre variant={variant}>{children}</MarkdownPre>
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
