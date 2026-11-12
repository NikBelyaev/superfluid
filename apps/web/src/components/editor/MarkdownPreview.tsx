import { memo, useCallback, useSyncExternalStore } from 'react';
import { MarkdownText } from '~/components/ui/MarkdownText';
import { documents, type Doc } from '~/state/editor/Documents';
import { showSurface, useApp } from '~/state/workspaceStore';
import { tabGroup, type TabGroup } from '~/state/workspaceView';
import { desktop } from '~/rpc/desktop';

export const MarkdownPreview = memo(function MarkdownPreview({
  doc,
  group,
}: {
  doc: Doc;
  group: TabGroup;
}) {
  const subscribe = useCallback(
    (changed: () => void) => {
      const subscription = doc.model.onDidChangeContent(changed);
      return () => subscription.dispose();
    },
    [doc],
  );
  const text = useSyncExternalStore(subscribe, () => doc.model.getValue());
  return (
    <article className="markdown-preview" aria-label="Markdown preview" tabIndex={0}>
      <MarkdownText
        text={text}
        variant="document"
        onLink={(href) => {
          const url = new URL(href, documents.uri(doc.session, doc.path).toString());
          if (url.protocol === 'superfluid-file:' && url.host === doc.session.id) {
            const path = decodeURIComponent(url.pathname.slice(1));
            const { tabs } = tabGroup(useApp.getState().views[doc.session.id], group);
            showSurface(
              tabs.find((tab) => tab.kind === 'file' && !tab.chain && tab.path === path) ?? {
                kind: 'file',
                path,
                preview: true,
              },
              doc.session.id,
              group,
            );
          } else void desktop.external(url.href).catch(useApp.getState().fail);
        }}
      />
    </article>
  );
});
