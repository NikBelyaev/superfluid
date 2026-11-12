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
    content.onwheel = (event) => {
      const scrollable = editor.getDomNode()?.querySelector('.monaco-scrollable-element');
      if (!scrollable) return;
      const forwarded = new WheelEvent('wheel', event);
      scrollable.dispatchEvent(forwarded);
      if (forwarded.defaultPrevented) event.preventDefault();
      event.stopPropagation();
    };
    root.append(content, toolbar);
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const text = change.original.replace(/(?:\r\n|\r|\n)$/, '');
    const height = change.original ? text.split(/\r\n|\r|\n/).length * lineHeight : 0;
    const previewModel = change.original
      ? monaco.editor.createModel(text, model.getLanguageId())
      : undefined;
    previewModel?.updateOptions({ tabSize: model.getOptions().tabSize });
    const preview = previewModel
      ? monaco.editor.create(content, {
          model: previewModel,
          readOnly: true,
          domReadOnly: true,
          ariaLabel: 'Previous version (read only)',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          scrollBeyondLastColumn: 0,
          dimension: { width: editor.getLayoutInfo().contentWidth + 16, height: 1 },
          scrollbar: {
            vertical: 'hidden',
            horizontal: 'hidden',
            verticalScrollbarSize: 0,
            horizontalScrollbarSize: 0,
            handleMouseWheel: false,
          },
          lineHeight,
          fontFamily: editor.getOption(monaco.editor.EditorOption.fontFamily),
          fontSize: editor.getOption(monaco.editor.EditorOption.fontSize),
          lineNumbers: 'off',
          lineDecorationsWidth: 16,
          overviewRulerLanes: 0,
          renderLineHighlight: 'none',
          folding: false,
          stickyScroll: { enabled: false },
          padding: { top: 0, bottom: 0 },
        })
      : undefined;
    const widget: monaco.editor.IOverlayWidget = {
      getId: () => 'superfluid.gitInlineDiff',
      getDomNode: () => root,
      getPosition: () => null,
      getMinContentWidthInPx: () => preview?.getContentWidth() ?? 0,
    };
    editor.addOverlayWidget(widget);
    preview?.updateOptions({
      scrollBeyondLastColumn: Math.ceil(
        (toolbar.offsetWidth + 12) /
          editor.getOption(monaco.editor.EditorOption.fontInfo).typicalHalfwidthCharacterWidth,
      ),
    });
    let zone = '';
    let zoneTop = 0;
    const layout = () => {
      const info = editor.getLayoutInfo();
      const left = info.contentLeft - 16;
      const width = info.contentWidth + 16;
      root.style.left = `${left}px`;
      root.style.width = `${width}px`;
      let end: number | undefined;
      if (preview && previewModel) {
        const clipped = Math.max(0, -zoneTop);
        const top = Math.max(0, zoneTop);
        const visible = Math.max(0, Math.min(height - clipped, info.height - top));
        root.style.top = `${top}px`;
        root.style.height = `${visible}px`;
        root.style.display = visible ? '' : 'none';
        content.style.height = `${visible}px`;
        // Only render the visible part of a removed block; the parent editor owns scrolling.
        preview.layout({ width, height: Math.max(1, visible) });
        preview.setScrollPosition({ scrollTop: clipped, scrollLeft: editor.getScrollLeft() });
        end = preview.getScrolledVisiblePosition({
          lineNumber: 1,
          column: previewModel.getLineMaxColumn(1),
        })?.left;
        toolbar.style.top = `${-clipped + (lineHeight - 28) / 2}px`;
        toolbar.style.display = clipped >= lineHeight ? 'none' : '';
      } else {
        const position = editor.getScrolledVisiblePosition({
          lineNumber: change.start,
          column: model.getLineMaxColumn(change.start),
        });
        root.style.top = `${position?.top ?? 0}px`;
        root.style.height = '28px';
        root.style.display =
          position && position.top >= 0 && position.top < info.height ? '' : 'none';
        end = position ? position.left - left : undefined;
        toolbar.style.top = `${(lineHeight - 28) / 2}px`;
      }
      toolbar.style.left = `${Math.max(16, Math.min(width - toolbar.offsetWidth, (end ?? width) + 12))}px`;
    };
    // Monaco hides view zones from assistive technology; keep their content in an accessible overlay.
    const viewZone: monaco.editor.IViewZone = {
      domNode: document.createElement('div'),
      afterLineNumber: change.modifiedLine - 1,
      heightInPx: height,
      showInHiddenAreas: true,
      onDomNodeTop: (top) => {
        zoneTop = top;
        if (zone) layout();
      },
    };
    if (preview) {
      editor.changeViewZones((accessor) => {
        zone = accessor.addZone(viewZone);
      });
    }
    const resized = editor.onDidLayoutChange(layout);
    const scrolled = editor.onDidScrollChange(layout);
    const measured = preview?.onDidContentSizeChange(() => {
      editor.layoutOverlayWidget(widget);
      layout();
    });
    layout();
    editor.layoutOverlayWidget(widget);
    const previewLine = previewModel
      ? [
          {
            range: previewModel.getFullModelRange(),
            options: {
              isWholeLine: true,
              className: 'git-inline-line-deleted',
              linesDecorationsClassName: 'git-inline-removed',
            },
          },
        ]
      : [];
    const currentLines = change.modified
      ? [
          {
            range: new monaco.Range(change.start, 1, change.end, 1),
            options: { isWholeLine: true, className: `git-inline-line-${change.kind}` },
          },
        ]
      : [];
    const previewHighlights = preview?.createDecorationsCollection(previewLine);
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
      previewHighlights?.set([
        ...previewLine,
        ...ranges.map((range) => word(range.original, 'deleted')),
      ]);
      currentHighlights.set([
        ...currentLines,
        ...ranges.map((range) => word(range.modified, 'added', change.modifiedLine - 1)),
      ]);
    };
    worker.postMessage({ inline: { original: change.original, modified: change.modified } });
    if (preview) {
      const anchor = Math.min(model.getLineCount(), change.modifiedLine);
      editor.setScrollTop(
        Math.max(
          0,
          editor.getTopForLineNumber(anchor) - height - editor.getLayoutInfo().height / 3,
        ),
        monaco.editor.ScrollType.Immediate,
      );
    } else editor.revealLineInCenter(line, monaco.editor.ScrollType.Immediate);
    close = () => {
      selected = undefined;
      closed = true;
      worker.terminate();
      currentHighlights.clear();
      measured?.dispose();
      resized.dispose();
      scrolled.dispose();
      if (zone) {
        const id = zone;
        zone = '';
        editor.changeViewZones((accessor) => accessor.removeZone(id));
      }
      editor.removeOverlayWidget(widget);
      preview?.dispose();
      previewModel?.dispose();
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
  const escape = editor.onKeyDown((event) => {
    if (event.keyCode === monaco.KeyCode.Escape && selected !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  return () => {
    close();
    decorations.clear();
    click.dispose();
    action.dispose();
    changed.dispose();
    switched.dispose();
    escape.dispose();
  };
}
