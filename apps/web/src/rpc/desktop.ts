import type { Bridge } from '@superfluid/contracts';

export const desktop: Bridge = {
  call: (method, input) => window.superfluid.call(method, input),
  onEvent: (listener) => window.superfluid.onEvent(listener),
  onFlush: (listener) => window.superfluid.onFlush(listener),
  chooseProject: () => window.superfluid.chooseProject(),
  chooseDirectory: () => window.superfluid.chooseDirectory(),
  exportText: (text, name) => window.superfluid.exportText(text, name),
  trash: (sessionId, path) => window.superfluid.trash(sessionId, path),
  external: (url) => window.superfluid.external(url),
  browser: (input) => window.superfluid.browser(input),
};
