import type { PythonLocation, PythonSymbol } from '@superfluid/contracts';
import { documents, monaco, type Doc } from '~/state/editor/Documents';
import { useApp } from '~/state/workspaceStore';
import { navigate } from './navigation';
import './definition.css';

const command = 'superfluid.previewDefinition';

type LinkArgs = [string, number, PythonLocation['position'], PythonLocation];

export function definitionLink(
  doc: Doc,
  position: PythonLocation['position'],
  target: PythonSymbol,
) {
  const args: LinkArgs = [doc.model.uri.toString(), doc.version, position, target];
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

export const definitionTrust = { enabledCommands: [command] };

export async function openDefinition(...[uri, version, position, target]: LinkArgs) {
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));
  const doc = model && documents.find(model);
  if (!doc || doc.version !== version || useApp.getState().sessionId !== doc.session.id) return;
  await navigate(
    doc.session,
    monaco.Uri.parse(target.uri),
    target.position.line + 1,
    target.position.character + 1,
    {
      path: doc.path,
      line: position.line + 1,
      column: position.character + 1,
      label: doc.path.split('/').at(-1)!,
    },
  );
}

monaco.editor.registerCommand(command, (_accessor, ...args: LinkArgs) =>
  openDefinition(...args).catch(useApp.getState().fail),
);

export function installDefinitionHover(root: HTMLElement) {
  const click = (event: MouseEvent) => {
    if (
      !(event.metaKey || (event.ctrlKey && !navigator.platform.includes('Mac'))) ||
      event.button !== 0
    )
      return;
    const card = event.target instanceof Element ? event.target.closest('.monaco-hover') : null;
    const links = card?.querySelectorAll<HTMLElement>(`a[data-href^="command:${command}?"]`);
    const clicked =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(`a[data-href^="command:${command}?"]`)
        : null;
    const href = clicked?.dataset.href ?? links?.[links.length - 1]?.dataset.href;
    if (!href) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void openDefinition(
      ...(JSON.parse(decodeURIComponent(href.slice(href.indexOf('?') + 1))) as LinkArgs),
    ).catch(useApp.getState().fail);
  };
  root.addEventListener('click', click, true);
  return () => root.removeEventListener('click', click, true);
}
