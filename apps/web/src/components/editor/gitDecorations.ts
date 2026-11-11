import type { FileDiffMetadata } from '@pierre/diffs';
import { monaco } from './monaco';
import { lineMarkers } from '~/components/diffs/lineMarkers';
import { inlineHunk, rollbackEdit } from '~/components/diffs/inlineHunk';
import type { inlineRanges } from '~/components/diffs/inlineRanges';
import DiffWorker from '~/components/diffs/diff.worker?worker';
import './gitDecorations.css';

export function installGitDecorations(
  editor: monaco.editor.IStandaloneCodeEditor,
  file: FileDiffMetadata,
  version: number,
  openFileDiff: () => void,
) {
  const model = editor.getModel();
  if (!model || model.getVersionId() !== version) return () => {};
  let close = () => {};
  let selected: number | undefined;
  const decorations = editor.createDecorationsCollection(
    lineMarkers(file).map((marker) => ({
      range: new monaco.Range(marker.start, 1, marker.end, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: `git-line-${marker.kind}${marker.before ? ' git-line-before' : ''}`,
        linesDecorationsTooltip: `${marker.kind === 'added' ? 'Added' : marker.kind === 'modified' ? 'Modified' : 'Deleted'} lines compared with the Git index. Click to view inline diff.`,
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    })),
  );
  const open = (line: number) => {
    if (model.getVersionId() !== version || editor.getModel() !== model) return;
    const change = inlineHunk(file, line);
    if (!change) return;
    const toggle = selected === change.start;
    close();
    if (toggle) return;
    selected = change.start;
    const root = document.createElement('div');
    root.className = 'git-inline-diff';
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Inline Git diff');
    const toolbar = document.createElement('div');
    toolbar.className = 'git-inline-toolbar';
    const full = document.createElement('button');
    full.className = 'icon-button';
    full.setAttribute('aria-label', 'Open file diff');
    full.title = 'Open file diff';
    full.onclick = () => {
      close();
      openFileDiff();
    };
    const rollback = document.createElement('button');
    rollback.className = 'icon-button';
    rollback.setAttribute('aria-label', 'Rollback change');
    rollback.disabled = file.additionLines.join('') !== model.getValue(undefined, true);
    rollback.title = rollback.disabled
      ? 'This file is missing on disk. Restore the file before rolling back individual changes.'
      : 'Restore this change from the Git index (Undo available)';
    rollback.onclick = () => {
      if (model.getVersionId() !== version || editor.getModel() !== model) return;
      const edit = rollbackEdit(file, change);
      const bom = model.getValue(undefined, true).length - model.getValueLength();
      editor.pushUndoStop();
      editor.executeEdits('git.rollbackHunk', [
        {
          range: monaco.Range.fromPositions(
            model.getPositionAt(Math.max(0, edit.start - bom)),
            model.getPositionAt(Math.max(0, edit.end - bom)),
          ),
          text: bom && edit.start === 0 ? edit.text.replace(/^\uFEFF/, '') : edit.text,
        },
      ]);
      editor.pushUndoStop();
      editor.focus();
    };
    const dismiss = document.createElement('button');
    dismiss.className = 'icon-button';
    dismiss.setAttribute('aria-label', 'Close inline diff');
    dismiss.title = 'Close inline diff (Esc)';
    dismiss.onclick = () => {
      close();
      editor.focus();
    };
    for (const [button, name] of [
      [full, 'diff'],
      [rollback, 'discard'],
      [dismiss, 'close'],
    ] as const) {
      const icon = document.createElement('span');
      icon.className = `codicon codicon-${name}`;
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      toolbar.append(button);
    }
    const content = document.createElement('div');
    content.className = 'git-inline-content';
    root.append(toolbar, content);
    let zone = '';
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const previous = change.kind !== 'added';
    const text = (previous ? change.original : change.modified).replace(/(?:\r\n|\r|\n)$/, '');
    let height = Math.min(320, text.split(/\r\n|\r|\n/).length * lineHeight + 8);
    content.style.height = `${height}px`;
    root.style.width = `${editor.getLayoutInfo().contentWidth}px`;
    const widget: monaco.editor.IOverlayWidget = {
      getId: () => 'superfluid.gitInlineDiff',
      getDomNode: () => root,
      getPosition: () => null,
    };
    editor.addOverlayWidget(widget);
    // Monaco hides view zones from assistive technology; keep the interactive view in an overlay.
    const viewZone: monaco.editor.IViewZone = {
      domNode: document.createElement('div'),
      afterLineNumber: change.before ? 0 : change.end,
      heightInPx: height + 34,
      showInHiddenAreas: true,
      onDomNodeTop: (top) => {
        root.style.top = `${top}px`;
      },
    };
    editor.changeViewZones((accessor) => {
      zone = accessor.addZone(viewZone);
    });
    const previewModel = monaco.editor.createModel(text, model.getLanguageId());
    const preview = monaco.editor.create(content, {
      model: previewModel,
      readOnly: true,
      domReadOnly: true,
      ariaLabel: previous ? 'Previous version (read only)' : 'Added lines (read only)',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      scrollBeyondLastColumn: 2,
      automaticLayout: true,
      lineHeight,
      fontFamily: editor.getOption(monaco.editor.EditorOption.fontFamily),
      fontSize: editor.getOption(monaco.editor.EditorOption.fontSize),
      lineNumbers: 'off',
      lineDecorationsWidth: 8,
      overviewRulerLanes: 0,
      renderLineHighlight: 'none',
      folding: false,
      stickyScroll: { enabled: false },
      padding: { top: 4, bottom: 4 },
    });
    const layout = () => {
      const info = editor.getLayoutInfo();
      const width = Math.max(
        toolbar.offsetWidth,
        preview.getContentWidth() + preview.getLayoutInfo().contentLeft,
      );
      root.style.left = `${info.contentLeft}px`;
      root.style.width = `${Math.min(info.contentWidth, width + 2)}px`;
      const contentHeight = Math.min(320, preview.getContentHeight());
      if (height !== contentHeight) {
        height = contentHeight;
        content.style.height = `${height}px`;
        viewZone.heightInPx = height + 34;
        editor.changeViewZones((accessor) => accessor.layoutZone(zone));
      }
    };
    const resized = editor.onDidLayoutChange(layout);
    const measured = preview.onDidContentSizeChange(layout);
    layout();
    const previewLine = {
      range: previewModel.getFullModelRange(),
      options: { isWholeLine: true, className: `git-inline-line-${change.kind}` },
    };
    const currentLines = change.modified
      ? [
          {
            range: new monaco.Range(change.start, 1, change.end, 1),
            options: { isWholeLine: true, className: `git-inline-line-${change.kind}` },
          },
        ]
      : [];
    const previewHighlights = preview.createDecorationsCollection([previewLine]);
    const currentHighlights = editor.createDecorationsCollection(currentLines);
    const worker = new DiffWorker();
    let closed = false;
    const word = (range: monaco.IRange, kind: 'added' | 'deleted', offset = 0) => {
      const empty =
        range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn;
      return {
        range: new monaco.Range(
          range.startLineNumber + offset,
          range.startColumn,
          range.endLineNumber + offset,
          range.endColumn,
        ),
        options: {
          inlineClassName: `git-inline-word-${kind}`,
          before: empty
            ? {
                content: '\u200b',
                inlineClassName: `git-inline-word-${kind} git-inline-word-empty`,
              }
            : undefined,
        },
      };
    };
    worker.onmessage = (event: MessageEvent<{ ranges?: ReturnType<typeof inlineRanges> }>) => {
      if (closed || !event.data.ranges || model.getVersionId() !== version) return;
      const ranges = event.data.ranges;
      previewHighlights.set([
        previewLine,
        ...ranges.map((range) =>
          word(previous ? range.original : range.modified, previous ? 'deleted' : 'added'),
        ),
      ]);
      currentHighlights.set([
        ...currentLines,
        ...ranges.map((range) => word(range.modified, 'added', change.modifiedLine - 1)),
      ]);
    };
    worker.postMessage({ inline: { original: change.original, modified: change.modified } });
    editor.revealLineInCenter(line, monaco.editor.ScrollType.Immediate);
    close = () => {
      selected = undefined;
      closed = true;
      worker.terminate();
      currentHighlights.clear();
      preview.dispose();
      previewModel.dispose();
      editor.changeViewZones((accessor) => accessor.removeZone(zone));
      editor.removeOverlayWidget(widget);
      resized.dispose();
      measured.dispose();
      close = () => {};
    };
    root.onkeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        editor.focus();
      }
    };
    dismiss.focus();
  };
  const click = editor.onMouseDown((event) => {
    if (
      !event.event.leftButton ||
      event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS ||
      !event.target.position
    )
      return;
    if (!event.target.element?.closest('[class*="git-line-"]')) return;
    event.event.preventDefault();
    open(event.target.position.lineNumber);
  });
  const action = editor.addAction({
    id: 'superfluid.inlineDiff',
    label: 'Show inline Git diff',
    contextMenuGroupId: 'navigation',
    run: () => {
      const position = editor.getPosition();
      if (position) open(position.lineNumber);
    },
  });
  const changed = model.onDidChangeContent(() => {
    close();
    decorations.clear();
  });
  const switched = editor.onDidChangeModel(() => close());
  return () => {
    close();
    decorations.clear();
    click.dispose();
    action.dispose();
    changed.dispose();
    switched.dispose();
  };
}
