import { monaco } from './monaco';
import './surfaces.css';
import {
  choiceRow,
  iconActionClasses,
  keycap,
  keyHint,
  menuLabel,
  numberedShortcut,
} from './surfaceElements';
import { showChoiceMenu } from './choiceMenu';
import { useApp } from '~/state/workspaceStore';
import { layoutHover, scrollHover } from './hoverLayout';

type CodeActionItem = { action: monaco.languages.CodeAction };
type HoverWidget = {
  handleContentsChanged(): void;
  _hover: { contentsDomNode: HTMLElement };
  _findMaximumRenderingHeight(): number | undefined;
  _findAvailableSpaceVertically(): number | undefined;
};

const menuIcons: Record<string, string> = {
  Search: 'search',
  'Copy reference': 'references',
  'Copy name': 'copy',
  Rename: 'edit',
  'Rename alias': 'edit',
  'Delete definition': 'trash',
  'Choose definition': 'list-selection',
  'Go to Definition': 'go-to-file',
  Peek: 'list-selection',
  'Peek Definition': 'go-to-file',
  'Peek References': 'references',
  'Optimize Imports': 'list-ordered',
  'Change All Occurrences': 'symbol-variable',
  Cut: 'scissors',
  Copy: 'copy',
  Paste: 'clippy',
  'Select All': 'selection',
};

export function installEditorSurfaces(
  editor: monaco.editor.IStandaloneCodeEditor,
  root: HTMLElement,
) {
  for (const style of ['[--editor-shortcut-width:112px]', '[--editor-choice-shortcut-width:56px]'])
    root.classList.toggle(style, !navigator.platform.includes('Mac'));
  // Hover imports marker navigation; Monaco has no option to disable its inline viewer.
  const problems = editor.getContribution<
    monaco.editor.IEditorContribution & {
      showAtMarker(): void;
      navigate(): Promise<void>;
    }
  >('editor.contrib.markerController');
  if (problems) {
    problems.showAtMarker = () => {};
    problems.navigate = async () => {};
  }
  const suggest = editor.getContribution<
    monaco.editor.IEditorContribution & {
      widget: {
        value: {
          element: { domNode: HTMLElement };
          onDidShow(listener: () => void): monaco.IDisposable;
          _list: {
            updateOptions(options: { paddingTop: number; paddingBottom: number }): void;
            reveal(index: number, relativeTop?: number, paddingTop?: number): void;
            getFocus(): number[];
            setFocus(indexes: number[]): void;
          };
        };
      };
    }
  >('editor.contrib.suggestController')?.widget.value;
  const list = suggest?._list;
  const suggestShown = suggest?.onDidShow(() =>
    suggest.element.domNode.classList.remove('pointer-active'),
  );
  const pointerMove = (event: PointerEvent) => {
    if (!event.movementX && !event.movementY) return;
    if (!(event.target instanceof Element)) return;
    event.target.closest('.suggest-widget, .editor-choice-menu')?.classList.add('pointer-active');
    const row = event.target.closest<HTMLElement>('.suggest-widget .monaco-list-row');
    const index = row?.dataset.index;
    if (index !== undefined && list && list.getFocus()[0] !== Number(index))
      list.setFocus([Number(index)]);
  };
  const keyboard = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key))
      root
        .querySelectorAll('.pointer-active')
        .forEach((menu) => menu.classList.remove('pointer-active'));
    scrollHover(event);
  };
  root.addEventListener('pointermove', pointerMove, true);
  root.addEventListener('keydown', keyboard, true);
  if (list) {
    list.updateOptions({ paddingTop: 8, paddingBottom: 8 });
    const reveal = list.reveal.bind(list);
    // Monaco's initial reveal would otherwise scroll the top padding away.
    list.reveal = (index, relativeTop, paddingTop = 0) =>
      reveal(index, relativeTop, Math.max(8, paddingTop));
  }
  // Keep Monaco's action resolution and application, with the same chooser as explicit imports.
  const codeActions = editor.getContribution<
    monaco.editor.IEditorContribution & {
      showCodeActionList(
        actions: { validActions: CodeActionItem[]; allActions: CodeActionItem[] },
        at: unknown,
        options: { includeDisabledActions: boolean; fromLightbulb: boolean },
      ): Promise<void>;
      applyCodeAction(
        action: CodeActionItem,
        retrigger: boolean,
        preview: boolean,
        reason: string,
      ): Promise<void>;
    }
  >('editor.contrib.codeActionController');
  const originalCodeActionList = codeActions?.showCodeActionList;
  if (codeActions)
    codeActions.showCodeActionList = async (actions, _at, options) => {
      const items =
        actions.validActions.length || !options.includeDisabledActions
          ? actions.validActions
          : actions.allActions;
      if (!items.length) return;
      editor
        .getContribution<monaco.editor.IEditorContribution & { hideContentHover(): void }>(
          'editor.contrib.contentHover',
        )
        ?.hideContentHover();
      editor.trigger('choices', 'hideSuggestWidget', {});
      showChoiceMenu(
        editor,
        items.map(({ action }) => ({ label: action.title, disabled: action.disabled })),
        (index) => {
          void codeActions
            .applyCodeAction(
              items[index]!,
              true,
              false,
              options.fromLightbulb ? 'fromAILightbulb' : 'fromCodeActions',
            )
            .catch(useApp.getState().fail);
        },
      );
    };
  const rendered = new WeakMap<HTMLElement, string>();
  const hoverHeights = new Map<HoverWidget, HoverWidget['_findMaximumRenderingHeight']>();
  const update = () => {
    let hoverChanged = false;
    const mac = navigator.platform.includes('Mac');
    const mod = mac ? '⌘' : 'Ctrl+';
    const shortcuts: Record<string, string> = {
      Search: mac ? '⇧F12' : 'Shift+F12',
      'Copy reference': mac ? '⇧⌥⌘C' : 'Ctrl+Alt+Shift+C',
      'Copy name': mac ? '⇧⌥⌘C' : 'Ctrl+Alt+Shift+C',
      Rename: 'F2',
      'Rename alias': 'F2',
      Cut: `${mod}X`,
      Copy: `${mod}C`,
      Paste: `${mod}V`,
      'Select All': `${mod}A`,
    };
    for (const label of root.querySelectorAll<HTMLElement>(
      '.monaco-menu .action-label[aria-label]:not(.separator)',
    )) {
      const name = label.getAttribute('aria-label')!;
      const iconName = menuIcons[name];
      if (iconName && !label.querySelector('.codicon')) {
        const icon = document.createElement('span');
        icon.className = `codicon codicon-${iconName}`;
        if (iconName === 'scissors')
          icon.innerHTML =
            '<svg class="block size-3.5 fill-none stroke-current stroke-[1.5] [stroke-linecap:round] [stroke-linejoin:round]" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.12 8.12 12 12M14 14l6-6M8.12 15.88 12 12"/></svg>';
        icon.setAttribute('aria-hidden', 'true');
        label.prepend(icon);
      }
      const item = label.closest('.action-menu-item');
      const nativeKey = item?.querySelector<HTMLElement>('.keybinding');
      const shortcut = nativeKey?.textContent?.trim() || shortcuts[name];
      if (nativeKey && !nativeKey.hidden) {
        nativeKey.hidden = true;
        if (shortcut && !item?.querySelector('kbd')) item?.append(keycap(shortcut, 'action'));
      } else if (item && shortcut && !item.querySelector('kbd'))
        item.append(keycap(shortcut, 'action'));
      if (!label.querySelector('.editor-menu-label')) {
        const text = menuLabel('');
        for (const child of [...label.childNodes])
          if (!(child instanceof Element && child.classList.contains('codicon')))
            text.append(child);
        label.append(text);
      }
    }
    for (const message of root.querySelectorAll<HTMLElement>(
      '.suggest-widget.message > .message',
    )) {
      if (message.querySelector('.codicon')) continue;
      const icon = document.createElement('span');
      icon.className = 'codicon codicon-search';
      icon.setAttribute('aria-hidden', 'true');
      message.prepend(icon);
    }
    for (const signature of root.querySelectorAll<HTMLElement>(
      '.suggest-widget .signature-label',
    )) {
      const text = signature.textContent ?? '';
      if (!text || (rendered.get(signature) === text && signature.firstElementChild)) continue;
      rendered.set(signature, text);
      const tokens = monaco.editor.tokenize(text, 'python')[0] ?? [];
      const spans = tokens.map((token, index) => {
        const span = document.createElement('span');
        const value = text.slice(token.offset, tokens[index + 1]?.offset);
        span.textContent = value;
        span.className =
          'completion-token data-[token^=keyword]:text-[color-mix(in_srgb,light-dark(#167466,#79c4b7)_65%,var(--muted-foreground))] data-[type=true]:text-[color-mix(in_srgb,light-dark(#167466,#79c4b7)_65%,var(--muted-foreground))] data-[token^=string]:text-[light-dark(#a34623,#ce9178)] data-[token^=number]:text-[light-dark(#167466,#79c4b7)]';
        span.dataset.token = token.type;
        if (/^[A-Z]\w*$/.test(value.trim())) span.dataset.type = 'true';
        return span;
      });
      if (spans.length) signature.replaceChildren(...spans);
    }
    for (const card of root.querySelectorAll<HTMLElement>('.monaco-hover')) {
      const marker = card.querySelector<HTMLElement>('.marker');
      const meta = marker?.querySelector<HTMLElement>(':scope > span:nth-child(2)');
      if (marker && meta) {
        const message = marker.firstElementChild as HTMLElement;
        if (!message.classList.contains('diagnostic-message')) {
          const model = editor.getModel();
          const severity =
            model &&
            monaco.editor
              .getModelMarkers({ resource: model.uri })
              .find((item) => item.message === message.textContent)?.severity;
          const icon = document.createElement('span');
          icon.className = `codicon ${severity === monaco.MarkerSeverity.Error ? 'codicon-error' : severity === monaco.MarkerSeverity.Warning ? 'codicon-warning' : 'codicon-info'}`;
          icon.setAttribute('aria-hidden', 'true');
          message.classList.add('diagnostic-message');
          message.prepend(icon);
          hoverChanged = true;
        }
        if (!meta.classList.contains('diagnostic-meta')) {
          meta.classList.add('diagnostic-meta');
          meta.firstChild &&
            (meta.firstChild.textContent =
              meta.firstChild.textContent?.replace(/^(.+?)\((.+)\)$/, '$1 · $2') ?? '');
          hoverChanged = true;
        }
        for (const code of card.querySelectorAll<HTMLElement>(
          '.markdown-hover p > code:only-child',
        )) {
          if (code.textContent?.trim() !== 'Unknown') continue;
          const row = code.closest<HTMLElement>('.hover-row');
          if (!row || row.classList.contains('diagnostic-type-row')) continue;
          row.classList.add('diagnostic-type-row');
          const badge = document.createElement('span');
          badge.className =
            'diagnostic-type ml-auto inline-flex h-[18px] shrink-0 items-center rounded-[5px] border border-solid border-border px-1.5 font-sans text-[10px] leading-[18px] text-muted-foreground';
          badge.textContent = 'Unknown';
          meta.append(badge);
          hoverChanged = true;
        }
        const footer = card.querySelector<HTMLElement>('.status-bar');
        const copy = marker.closest('.hover-row')?.querySelector<HTMLElement>('.hover-copy-button');
        if (footer && copy && !footer.querySelector('.diagnostic-copy')) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `diagnostic-copy ml-auto ${iconActionClasses}`;
          button.setAttribute('aria-label', 'Copy diagnostic');
          const icon = document.createElement('span');
          icon.className = 'codicon codicon-copy';
          icon.setAttribute('aria-hidden', 'true');
          button.append(icon);
          button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            copy.click();
          };
          footer.append(button);
          hoverChanged = true;
        }
      }
      for (const link of card.querySelectorAll<HTMLElement>('.status-bar .action')) {
        if (decorateShortcut(link)) hoverChanged = true;
      }
      for (const markdown of card.querySelectorAll<HTMLElement>(
        '.markdown-hover:has(a[data-href^="command:superfluid.applyImport"]) .rendered-markdown',
      )) {
        if (markdown.querySelector('.quick-fix-options')) continue;
        const options = document.createElement('div');
        options.className =
          'quick-fix-options min-h-0 max-h-24 overscroll-contain overflow-x-hidden overflow-y-auto';
        options.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });
        const links = markdown.querySelectorAll('a[data-href^="command:superfluid.applyImport"]');
        for (const link of links) {
          const row = link.closest('p');
          if (row) options.append(row);
        }
        const heading = markdown.querySelector('p:has(strong)');
        if (heading) {
          heading.classList.add('quick-fix-heading');
          const count = document.createElement('span');
          count.textContent = `${links.length} options`;
          heading.append(count);
        }
        markdown.append(options);
        hoverChanged = true;
      }
      hoverChanged = layoutHover(card) || hoverChanged;
    }
    for (const footer of root.querySelectorAll<HTMLElement>('.suggest-status-bar')) {
      if (!footer.querySelector('.suggest-navigation')) {
        const choose = keyHint('Choose', '↑', '↓');
        choose.classList.add('suggest-navigation');
        footer.prepend(choose);
        const escape = keycap('Esc', 'compact');
        escape.classList.add('editor-escape-key', 'ml-0');
        footer.append(escape);
      }
      for (const label of footer.querySelectorAll<HTMLElement>(
        '.left .action-item:first-child .action-label',
      )) {
        if (decorateShortcut(label, 'compact')) {
          label.firstChild!.textContent = 'Apply';
          label.prepend(label.lastChild!);
        }
      }
      for (const label of footer.querySelectorAll<HTMLElement>('.right .action-label')) {
        if (label.querySelector('.codicon')) continue;
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-list-selection';
        icon.setAttribute('aria-hidden', 'true');
        label.replaceChildren(icon);
        label.classList.add(...iconActionClasses.split(' '));
        label.setAttribute('aria-label', 'Toggle documentation');
        label.removeAttribute('title');
      }
    }
    const definitions = root.querySelectorAll<HTMLAnchorElement>(
      '.monaco-hover a[data-href][title="Open definition"]',
    );
    definitions.forEach((link, index) => {
      if (link.classList.contains('editor-choice-row')) return;
      const paragraph = link.closest('p');
      const file = paragraph?.nextElementSibling;
      const detail = file?.querySelector('code')?.textContent;
      choiceRow(link, link.textContent ?? '', numberedShortcut(index), detail ?? undefined);
      if (detail) file?.remove();
      hoverChanged = true;
    });
    for (const link of root.querySelectorAll<HTMLAnchorElement>(
      '.monaco-hover a[data-href^="command:superfluid.applyImport"]',
    )) {
      if (link.classList.contains('editor-choice-row')) continue;
      choiceRow(link, link.textContent ?? '', link.title);
      link.removeAttribute('title');
      hoverChanged = true;
    }
    for (const link of root.querySelectorAll<HTMLAnchorElement>(
      '.monaco-hover a[data-href^="command:superfluid.symbolAction"]',
    )) {
      const label = link.textContent?.trim() ?? '';
      link.setAttribute('aria-label', label);
      const args = JSON.parse(decodeURIComponent(link.dataset.href!.split('?')[1]));
      link.dataset.action = args[0];
      if (['search', 'copy', 'copy-name'].includes(args[0]))
        link.classList.add(...iconActionClasses.split(' '));
    }
    if (hoverChanged) {
      // Keycaps are added after Monaco measures the markdown; measure the finished card once.
      const widget = editor.getContribution<
        monaco.editor.IEditorContribution & {
          _contentWidget?: { _contentHoverWidget: HoverWidget };
        }
      >('editor.contrib.contentHover')?._contentWidget?._contentHoverWidget;
      if (widget && !hoverHeights.has(widget)) {
        const originalHeight = widget._findMaximumRenderingHeight;
        hoverHeights.set(widget, originalHeight);
        // Monaco measures child heights; the body now has a separate scrolling viewport.
        widget._findMaximumRenderingHeight = () => {
          const body =
            widget._hover.contentsDomNode.querySelector<HTMLElement>('.editor-hover-body');
          const footer =
            widget._hover.contentsDomNode.querySelector<HTMLElement>('.editor-hover-footer');
          if (!body || !footer) return originalHeight.call(widget);
          const available = widget._findAvailableSpaceVertically();
          return available
            ? Math.min(available, body.scrollHeight + footer.offsetHeight)
            : undefined;
        };
      }
      widget?.handleContentsChanged();
    }
  };
  const decorateShortcut = (label: HTMLElement, variant: 'normal' | 'compact' = 'normal') => {
    if (label.querySelector('kbd')) return false;
    const match = /^(.*?)\s+\(([^()]+)\)$/.exec(label.textContent ?? '');
    if (!match) return false;
    label.replaceChildren(document.createTextNode(match[1]!.trim()), keycap(match[2]!, variant));
    label.removeAttribute('title');
    return true;
  };
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          (record.target instanceof Element &&
            record.target.closest(
              '.suggest-widget, .monaco-hover, .action-widget, .monaco-menu',
            )) ||
          [...record.addedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches('.suggest-widget, .monaco-hover, .action-widget, .monaco-menu') ||
                node.querySelector('.suggest-widget, .monaco-hover, .action-widget, .monaco-menu')),
          ),
      )
    )
      update();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return () => {
    observer.disconnect();
    suggestShown?.dispose();
    root.removeEventListener('pointermove', pointerMove, true);
    root.removeEventListener('keydown', keyboard, true);
    for (const [widget, originalHeight] of hoverHeights)
      widget._findMaximumRenderingHeight = originalHeight;
    if (codeActions && originalCodeActionList)
      codeActions.showCodeActionList = originalCodeActionList;
  };
}
