import { desktop } from '~/rpc/desktop';
import { useEffect } from 'react';
import { useApp } from '~/state/workspaceStore';
import { documents, monaco } from '~/state/editor/Documents';

export function useDiagnostics() {
  useEffect(
    () =>
      desktop.onEvent((e) => {
        if (e.type === 'diagnostics') {
          const s = useApp.getState().sessions.find((s) => s.id === e.sessionId);
          if (!s) return;
          let uri;
          try {
            uri = monaco.Uri.parse(e.uri);
          } catch {
            return;
          }
          const root = s.path.replace(/\/$/, '') + '/';
          if (!uri.fsPath.startsWith(root)) return;
          const doc = documents.items.get(documents.key(s.id, uri.fsPath.slice(root.length)));
          if (!doc) return;
          monaco.editor.setModelMarkers(
            doc.model,
            'pyright',
            e.diagnostics.map((d) => ({
              startLineNumber: d.range.start.line + 1,
              startColumn: d.range.start.character + 1,
              endLineNumber: d.range.end.line + 1,
              endColumn: d.range.end.character + 1,
              message: d.message,
              severity:
                d.severity === 1
                  ? monaco.MarkerSeverity.Error
                  : d.severity === 2
                    ? monaco.MarkerSeverity.Warning
                    : monaco.MarkerSeverity.Info,
              source: 'Pyright',
              code: String(d.code ?? ''),
            })),
          );
        }
      }),
    [],
  );
}
