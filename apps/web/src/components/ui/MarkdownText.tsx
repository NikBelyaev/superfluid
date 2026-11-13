import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Children, isValidElement, type ReactNode } from 'react';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';
import { MermaidDiagram } from './MermaidDiagram';
import './markdownText.css';

function MarkdownPre({ children }: { children?: ReactNode }) {
  const code = Children.toArray(children)[0];
  return isValidElement<{ className?: string; children?: string }>(code) &&
    code.props.className === 'language-mermaid' &&
    typeof code.props.children === 'string' ? (
    <MermaidDiagram source={code.props.children} />
  ) : (
    <pre>{children}</pre>
  );
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  return (
    <div className="markdown-table" role="region" aria-label="Scrollable table" tabIndex={0}>
      <table>{children}</table>
    </div>
  );
}

export function MarkdownText({
  text,
  baseUrl,
  variant = 'compact',
  onLink,
  className = '',
}: {
  text: string;
  baseUrl?: string;
  variant?: 'compact' | 'document';
  onLink?: (href: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`markdown ${variant === 'document' ? 'markdown-document' : 'text-xs leading-5 [&_h1]:text-sm [&_h1]:leading-[22px] [&_h2]:text-sm [&_h2]:leading-[22px] [&_h3]:text-sm [&_h3]:leading-[22px]'} [&>:first-child]:mt-0 [&>:last-child]:mb-0 ${className}`}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: MarkdownTable,
          pre: MarkdownPre,
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) {
                  try {
                    if (onLink) onLink(href);
                    else
                      void desktop
                        .external(new URL(href, baseUrl).href)
                        .catch(useApp.getState().fail);
                  } catch (error) {
                    useApp.getState().fail(error);
                  }
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
