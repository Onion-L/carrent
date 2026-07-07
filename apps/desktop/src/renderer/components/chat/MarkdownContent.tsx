import ReactMarkdown from "react-markdown";
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

export function MarkdownContent({ children }: { children: string }) {
  const content = normalizeMathDelimiters(children);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <p className="text-[15px] leading-7 text-fg">{children}</p>,
        h1: ({ children }) => (
          <h1 className="text-[22px] font-semibold leading-tight text-fg">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-[18px] font-semibold leading-snug text-fg">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-[16px] font-semibold leading-snug text-fg">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-[15px] font-semibold leading-snug text-fg">{children}</h4>
        ),
        h5: ({ children }) => (
          <h5 className="text-[14px] font-semibold leading-snug text-fg">{children}</h5>
        ),
        h6: ({ children }) => (
          <h6 className="text-[13px] font-semibold leading-snug text-fg">{children}</h6>
        ),
        ul: ({ children }) => (
          <ul className="list-disc space-y-1 pl-5 text-[15px] leading-7 text-fg">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal space-y-1 pl-5 text-[15px] leading-7 text-fg">{children}</ol>
        ),
        li: ({ children }) => <li>{children}</li>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline underline-offset-2"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children, className }) => {
          const isInline = !className;
          if (isInline) {
            return (
              <code className="rounded bg-code-bg px-1 py-0.5 font-mono text-[13px] text-fg">
                {children}
              </code>
            );
          }
          return <code className="font-mono text-[13px] text-fg">{children}</code>;
        },
        pre: ({ children }) => (
          <pre className="overflow-x-auto rounded-lg bg-code-bg p-3 font-mono text-[13px] leading-relaxed text-fg">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-border pl-3 text-muted">{children}</blockquote>
        ),
        hr: () => <hr className="border-border" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
