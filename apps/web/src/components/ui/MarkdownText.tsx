import Markdown from 'react-markdown';
import { Children, isValidElement, type ReactNode } from 'react';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';
import { MermaidDiagram } from './MermaidDiagram';
import { markdownOptions } from './markdownOptions';
import './markdownText.css';

function MarkdownPre({ children }: { children?: ReactNode }) {
  const code = Children.toArray(children)[0];
  return isValidElement<{ className?: string; children?: string }>(code) &&
    code.props.className === 'language-mermaid' &&
    typeof code.props.children === 'string' ? (
    <MermaidDiagram source={code.props.children} />
  ) : (
    <pre tabIndex={0}>{children}</pre>
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
      className={`markdown ${variant === 'document' ? 'markdown-document' : 'text-xs leading-5 [&_h1]:text-sm [&_h1]:leading-[22px] [&_h2]:text-sm [&_h2]:leading-[22px] [&_h3]:text-sm [&_h3]:leading-[22px]'} [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_code]:box-decoration-clone [&_code]:bg-foreground/8 [&_code]:text-foreground [&_pre_code]:bg-transparent [&_pre_code]:text-inherit ${className}`}
    >
      <Markdown
        {...markdownOptions}
        components={{
          table: MarkdownTable,
          pre: MarkdownPre,
          a: ({ href, children }) => (
            <a
              className="no-underline hover:underline focus-visible:underline"
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
