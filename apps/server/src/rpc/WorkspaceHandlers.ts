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
  const repository = (input: { sessionId: string; repositoryId?: string }) =>
    sourceControl.repositories.target(session(input.sessionId), input.repositoryId);
  return {
    'sourceControl.discovery': () => workspace.sourceControlDiscovery.scan(),
    'sourceControl.repository': async (input) =>
      workspace.hosting.repository(await repository(input)),
    bootstrap: () => ({
      projects: store.all<Project>('projects').sort((a, b) => b.lastOpened - a.lastOpened),
      actions: store.all<Action>('actions'),
      runs: terminals.runs,
      operations: store.all<Operation>('operations'),
    }),
    'project.add': (input) => projects.add(input.path),
    'project.remote': async (input) =>
      projects.setRemote(session(input.sessionId), input, await repository(input)),
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
    'git.repositories': (input) =>
      sourceControl.repositories.list(session(input.sessionId), input.refresh),
    'git.worktree': (input) => sourceControl.createWorktree(session(input.sessionId), input),
    'git.status': (input) => sourceControl.status(session(input.sessionId), input.repositoryId),
    'git.init': (input) => sourceControl.initialize(session(input.sessionId)),
    'git.diff': (input) => sourceControl.diff(session(input.sessionId), input),
    'git.act': (input) => sourceControl.act(session(input.sessionId), input),
    'git.inspect': (input) => sourceControl.inspect(session(input.sessionId), input.operationId),
    'git.acknowledge': (input) => git.acknowledge(session(input.sessionId), input.operationId),
    'actions.save': (input) => actions.save(input),
    'actions.delete': (input) => actions.delete(input.id),
    'terminal.run': (input) => actions.run(session(input.sessionId), input),
    'terminal.command': (input) => terminals.call('command', input),
    'lsp.open': (input) => python.open(session(input.sessionId), input),
    'lsp.close': (input) => python.closeDocument(session(input.sessionId), input.path),
    'lsp.cancel': (input) => python.cancel(session(input.sessionId), input.requestId),
    'lsp.request': (input) => python.request(session(input.sessionId), input),
    'python.format': (input) => python.format(session(input.sessionId), input.text),
    'python.hover': (input) => python.hover(session(input.sessionId), input),
    'python.source': (input) => python.source(session(input.sessionId), input),
    'pr.read': async (input) => pullRequests.read(await repository(input), input),
    'pr.mergeState': async (input) => pullRequests.mergeState(await repository(input), input),
    'pr.merge': async (input) => pullRequests.merge(await repository(input), input),
    'pr.context': async (input) =>
      pullRequests.context(await repository(input), input.targetProject),
    'pr.remotes': async (input) => workspace.hosting.remotes(await repository(input)),
    'pr.list': async (input) => pullRequests.list(await repository(input), input),
    'pr.comments': async (input) => pullRequests.comments(await repository(input), input),
    'pr.checks': async (input) => pullRequests.checks(await repository(input), input),
    'pr.jobLog': async (input) => pullRequests.jobLog(await repository(input), input),
    'pr.timeline': async (input) => pullRequests.timeline(await repository(input), input),
    'pr.update': async (input) => pullRequests.update(await repository(input), input),
    'pr.patch': async (input) => pullRequests.patch(await repository(input), input),
    'pr.comment': async (input) => pullRequests.comment(await repository(input), input),
  };
}
