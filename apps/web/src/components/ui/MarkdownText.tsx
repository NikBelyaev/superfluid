import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { desktop } from '~/rpc/desktop';
import { useApp } from '~/state/workspaceStore';

export function MarkdownText({
  text,
  baseUrl,
  className = '',
}: {
  text: string;
  baseUrl?: string;
  className?: string;
}) {
  return (
    <div
      className={`markdown text-xs leading-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_h1]:text-sm [&_h1]:leading-[22px] [&_h2]:text-sm [&_h2]:leading-[22px] [&_h3]:text-sm [&_h3]:leading-[22px] ${className}`}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) {
                  try {
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
