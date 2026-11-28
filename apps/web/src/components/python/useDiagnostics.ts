import { desktop } from '~/rpc/desktop';
import { useEffect } from 'react';
import { useApp } from '~/state/workspaceStore';
import { documents, monaco } from '~/state/editor/Documents';
import { acceptPythonStatus, pythonGeneration } from '~/state/python';
import { syncGoDocument } from '~/rpc/go';

export function useDiagnostics() {
  useEffect(
    () =>
      desktop.onEvent((e) => {
        if (e.type === 'go.package' && e.changed) {
          const { sessionId } = useApp.getState();
          for (const doc of documents.items.values())
            if (doc.session.id === sessionId && !doc.closed && doc.model.getLanguageId() === 'go')
              void syncGoDocument(doc, true).catch(() => {});
          return;
        }
        if (e.type === 'lsp.status') {
          if (e.server === 'gopls') {
            const previous = useApp.getState().goLanguage[e.sessionId];
            if (previous && previous.generation > e.generation) return;
            useApp.setState((a) => ({ goLanguage: { ...a.goLanguage, [e.sessionId]: e } }));
            for (const doc of documents.items.values()) {
              if (
                doc.session.id !== e.sessionId ||
                doc.model.isDisposed() ||
                doc.model.getLanguageId() !== 'go'
              )
                continue;
              if (previous?.generation !== e.generation || e.phase !== 'ready')
                monaco.editor.setModelMarkers(doc.model, 'go', []);
              if (e.phase === 'ready' && !doc.closed) void documents.sync(doc).catch(() => {});
            }
            return;
          }
          const previous = pythonGeneration(e.sessionId);
          if (!acceptPythonStatus(e)) return;
          useApp.setState((a) => ({ language: { ...a.language, [e.sessionId]: e.status } }));
          if (e.generation !== previous || e.phase === 'stopped' || e.phase === 'error')
            for (const doc of documents.items.values())
              if (doc.session.id === e.sessionId && !doc.model.isDisposed())
                monaco.editor.setModelMarkers(doc.model, 'python', []);
          if (e.phase === 'ready') void documents.syncSession(e.sessionId, e.generation);
          return;
        }
        if (e.type === 'diagnostics') {
          const go = e.server === 'gopls';
          const generation = go
            ? useApp.getState().goLanguage[e.sessionId]?.generation
            : pythonGeneration(e.sessionId);
          if (e.generation !== generation) return;
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
          if (!doc || doc.model.isDisposed()) return;
          if (
            go !== (doc.model.getLanguageId() === 'go') ||
            (go && (doc.closed || (e.version !== undefined && e.version !== doc.version)))
          )
            return;
          monaco.editor.setModelMarkers(
            doc.model,
            go ? 'go' : 'python',
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
              source: d.source ?? (e.server === 'pyright' ? 'Pyright' : e.server),
              code: String(d.code ?? ''),
            })),
          );
        }
      }),
    [],
  );
}
