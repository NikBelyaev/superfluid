import type { FileDiffMetadata } from '@pierre/diffs';
import { monaco } from './monaco';
import { lineMarkers } from '~/components/diffs/lineMarkers';
import { inlineHunk } from '~/components/diffs/inlineHunk';
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
    const label = document.createElement('span');
    label.textContent = 'Index − / Working buffer +';
    const full = document.createElement('button');
    full.className = 'git-inline-action';
    full.textContent = 'Open file diff';
    full.onclick = () => {
      close();
      openFileDiff();
    };
    const dismiss = document.createElement('button');
    dismiss.className = 'icon-button';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', 'Close inline diff');
    dismiss.onclick = () => {
      close();
      editor.focus();
    };
    toolbar.append(label, full, dismiss);
    const content = document.createElement('div');
    content.className = 'git-inline-content';
    root.append(toolbar, content);
    let zone = '';
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
    const height = Math.min(
      320,
      (change.original.split('\n').length + change.modified.split('\n').length) * lineHeight + 12,
    );
    content.style.height = `${height}px`;
    const layout = () => {
      const info = editor.getLayoutInfo();
      root.style.left = `${info.contentLeft}px`;
      root.style.width = `${info.contentWidth}px`;
    };
    layout();
    const resized = editor.onDidLayoutChange(layout);
    const widget: monaco.editor.IOverlayWidget = {
      getId: () => 'superfluid.gitInlineDiff',
      getDomNode: () => root,
      getPosition: () => null,
    };
    editor.addOverlayWidget(widget);
    // Monaco hides view zones from assistive technology; keep the interactive view in an overlay.
    editor.changeViewZones((accessor) => {
      zone = accessor.addZone({
        domNode: document.createElement('div'),
        afterLineNumber: change.before ? 0 : line,
        heightInPx: height + 34,
        showInHiddenAreas: true,
        onDomNodeTop: (top) => {
          root.style.top = `${top}px`;
        },
      });
    });
    const original = monaco.editor.createModel(change.original, model.getLanguageId());
    const modified = monaco.editor.createModel(change.modified, model.getLanguageId());
    const diff = monaco.editor.createDiffEditor(content, {
      readOnly: true,
      domReadOnly: true,
      originalEditable: false,
      renderSideBySide: false,
      renderOverviewRuler: false,
      renderMarginRevertIcon: false,
      renderGutterMenu: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      lineHeight,
      fontFamily: editor.getOption(monaco.editor.EditorOption.fontFamily),
      fontSize: editor.getOption(monaco.editor.EditorOption.fontSize),
      lineNumbersMinChars: 3,
      folding: false,
      stickyScroll: { enabled: false },
      padding: { top: 4, bottom: 4 },
      diffAlgorithm: 'advanced',
      ignoreTrimWhitespace: false,
      originalAriaLabel: 'Index fragment (read only)',
      modifiedAriaLabel: 'Working buffer fragment (read only)',
    });
    const viewModel = diff.createViewModel({ original, modified });
    diff.setModel(viewModel);
    editor.revealLineInCenter(line, monaco.editor.ScrollType.Immediate);
    diff
      .getOriginalEditor()
      .updateOptions({ lineNumbers: (line) => String(change.originalLine + line - 1) });
    diff
      .getModifiedEditor()
      .updateOptions({ lineNumbers: (line) => String(change.modifiedLine + line - 1) });
    close = () => {
      selected = undefined;
      diff.setModel(null);
      viewModel.dispose();
      diff.dispose();
      original.dispose();
      modified.dispose();
      editor.changeViewZones((accessor) => accessor.removeZone(zone));
      editor.removeOverlayWidget(widget);
      resized.dispose();
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
