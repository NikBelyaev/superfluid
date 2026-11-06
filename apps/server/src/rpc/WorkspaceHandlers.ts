import type {
  Method,
  ParsedInput,
  Results,
  Project,
  Action,
  Operation,
} from '@superfluid/contracts';
import type { Workspace } from '../workspace/Workspace';

export type WorkspaceHandlers = {
  [M in Method]: (input: ParsedInput<M>) => Results[M] | Promise<Results[M]>;
};

export function createWorkspaceHandlers(workspace: Workspace): WorkspaceHandlers {
  const {
    store,
    projects,
    files,
    documents,
    git,
    sourceControl,
    actions,
    terminals,
    python,
    pullRequests,
  } = workspace;
  const session = (id: string) => projects.session(id);
  return {
    bootstrap: () => ({
      projects: store.all<Project>('projects').sort((a, b) => b.lastOpened - a.lastOpened),
      actions: store.all<Action>('actions'),
      runs: terminals.runs,
      operations: store.all<Operation>('operations'),
    }),
    'project.add': (input) => projects.add(input.path),
    'project.clone': (input) => projects.clone(input),
    'session.list': (input) => projects.sessions(input.projectId),
    'session.create': (input) => projects.createWorktree(session(input.sessionId), input),
    'session.state': (input) => projects.saveState(session(input.sessionId), input),
    'session.interpreter': (input) => projects.setInterpreter(session(input.sessionId), input),
    'files.list': (input) => documents.list(session(input.sessionId), input.path),
    'files.read': (input) => documents.read(session(input.sessionId), input),
    'files.save': (input) =>
      files.save(session(input.sessionId), input.path, input.text, input.hash),
    'files.create': async (input) => {
      await files.create(session(input.sessionId), input.path, input.directory);
      return null;
    },
    'files.rename': (input) => documents.rename(session(input.sessionId), input.path, input.target),
    'files.resolve': (input) => documents.resolve(session(input.sessionId), input.path),
    'files.search': (input) => files.search(session(input.sessionId), input.query, input.content),
    'draft.put': (input) => documents.putDraft(session(input.sessionId), input),
    'draft.drop': (input) => {
      store.dropDraft(session(input.sessionId).id, input.path, input.version);
      return null;
    },
    'git.status': (input) => git.status(session(input.sessionId)),
    'git.init': (input) => sourceControl.initialize(session(input.sessionId)),
    'git.diff': (input) => sourceControl.diff(session(input.sessionId), input),
    'git.act': (input) => sourceControl.act(session(input.sessionId), input),
    'git.inspect': (input) => git.inspect(session(input.sessionId), input.operationId),
    'git.acknowledge': (input) => git.acknowledge(session(input.sessionId), input.operationId),
    'actions.save': (input) => actions.save(input),
    'actions.delete': (input) => actions.delete(input.id),
    'terminal.run': (input) => actions.run(session(input.sessionId), input),
    'terminal.command': (input) => terminals.call('command', input),
    'lsp.open': (input) => python.open(session(input.sessionId), input),
    'lsp.close': (input) => python.closeDocument(session(input.sessionId), input.path),
    'lsp.request': (input) => python.request(session(input.sessionId), input),
    'python.format': (input) => python.format(session(input.sessionId), input.text),
    'pr.read': (input) => pullRequests.read(session(input.sessionId), input),
    'pr.patch': (input) => pullRequests.patch(session(input.sessionId), input),
    'pr.comment': (input) => pullRequests.comment(session(input.sessionId), input),
  };
}
