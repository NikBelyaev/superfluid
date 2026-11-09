import type { Input, Operation } from '@superfluid/contracts';
import { desktop } from '~/rpc/desktop';
import { useApp, showSurface } from '~/state/workspaceStore';
import { emptyView, mapViewFiles } from '~/state/workspaceView';
import type { Session } from '@superfluid/contracts';
import {
  canUseRepositoryBase,
  hasRepositoryChanges,
  selectedRepositories,
  gitActionProblem,
  gitOperationToReview,
  repositoriesForAction,
  repositoryBranch,
} from '~/state/repositories';
import { openGitReview } from '~/state/dialogs';

export type GitAction = Input<'git.act'>['action'];
export type GitMenuPage = 'repositories' | Exclude<GitAction, 'stash' | 'stash-apply'>;
type Request = Input<'git.act'>;
export interface GitBatch {
  id: string;
  sessionId: string;
  action: GitAction;
  startedAt: number;
  phase: 'running' | 'completed' | 'failed';
  entries: { request: Request; result?: Operation; error?: string }[];
  done: number;
}

export function openRepositoryMenu(
  sessionId: string,
  page: 'repositories' | GitAction = 'repositories',
) {
  const app = useApp.getState();
  const group = selectedRepositories(
    app.repositories[sessionId] || [],
    app.views[sessionId]?.repositoryIds,
  );
  const statuses = app.repositoryGit[sessionId];
  const operations = app.operations.filter((op) => op.sessionId === sessionId);
  const review = gitOperationToReview(sessionId, group, operations);
  if (page !== 'repositories' && review) {
    openGitReview(review);
    return;
  }
  const business = page !== 'repositories' && page !== 'create-branch' && page !== 'checkout';
  if (business) {
    const problem = gitActionProblem(page, group, statuses, operations);
    if (problem) {
      app.fail(new Error(problem));
      return;
    }
  }
  const targets = business ? repositoriesForAction(page, group, statuses) : group;
  if (
    targets.length &&
    (page === 'push' ||
      page === 'stash' ||
      page === 'stash-apply' ||
      ((page === 'pr' || (page === 'publish' && !hasRepositoryChanges(group, statuses))) &&
        targets.every((r) =>
          canUseRepositoryBase(statuses?.[r.id], statuses?.[r.id]?.baseBranch || ''),
        )))
  ) {
    useApp.setState({ island: true, palette: null });
    app.setView({ islandCollapsed: false }, sessionId);
    void runGitBatch(
      sessionId,
      page,
      targets.map((repository) => ({
        sessionId,
        repositoryId: repository.id,
        operationId: crypto.randomUUID(),
        action: page,
        branch: statuses?.[repository.id]?.branch || repository.branch,
        base: repositoryBranch(
          statuses?.[repository.id],
          statuses?.[repository.id]?.baseBranch || '',
        ),
        draft: false,
        stash: page === 'stash-apply' ? statuses?.[repository.id]?.stash : undefined,
      })),
      () =>
        useApp.setState((s) => ({
          repositoryMenu: s.repositoryMenu?.sessionId === sessionId ? null : s.repositoryMenu,
        })),
    ).catch(app.fail);
    return;
  }
  if (page === 'stash' || page === 'stash-apply') return;
  useApp.setState({ island: true, repositoryMenu: { sessionId, page }, palette: null });
  useApp.getState().setView({ islandCollapsed: false }, sessionId);
}

export async function runGitBatch(
  sessionId: string,
  action: GitAction,
  requests: Request[],
  onStart?: () => void,
) {
  const app = useApp.getState();
  if (app.repositoryWorktrees[sessionId]) throw new Error('Wait for worktree creation to finish.');
  if (app.gitBatches[sessionId]?.phase === 'running')
    throw new Error('Wait for the running Git action.');
  if (!requests.length) throw new Error('Choose at least one repository.');
  const repositories = app.repositories[sessionId] || [];
  const { documents } = await import('~/state/editor/Documents');
  await documents.saveSession(
    sessionId,
    requests.map((request) => repositories.find((r) => r.id === request.repositoryId)?.path ?? ''),
  );
  if (
    useApp.getState().repositoryWorktrees[sessionId] ||
    useApp.getState().gitBatches[sessionId]?.phase === 'running'
  )
    throw new Error('Wait for the running Git action.');
  let batch: GitBatch = {
    id: crypto.randomUUID(),
    sessionId,
    action,
    startedAt: Date.now(),
    phase: 'running',
    entries: requests.map((request) => ({ request })),
    done: 0,
  };
  const update = () =>
    useApp.setState((s) => ({ gitBatches: { ...s.gitBatches, [sessionId]: batch } }));
  update();
  onStart?.();
  for (let index = 0; index < batch.entries.length; index++) {
    const entry = batch.entries[index];
    try {
      const result = await desktop.call('git.act', entry.request);
      if (
        (result.phase === 'completed' ||
          !!result.evidence.autoStash ||
          !!result.evidence.conflicts) &&
        ['create-branch', 'checkout', 'stash', 'stash-apply'].includes(action)
      ) {
        const { documents } = await import('~/state/editor/Documents');
        const repository = repositories.find((r) => r.id === entry.request.repositoryId);
        documents.captureViews();
        for (const doc of documents.items.values()) {
          if (
            doc.session.id !== sessionId ||
            doc.dirty ||
            (repository?.path && !doc.path.startsWith(repository.path + '/'))
          )
            continue;
          try {
            await documents.reload(doc);
          } catch (error) {
            if (!doc.dirty && error instanceof Error && error.message.includes('ENOENT')) {
              documents.removePaths(sessionId, doc.path);
              const view = useApp.getState().views[sessionId];
              useApp.getState().setView(
                mapViewFiles(view, (path) => (path === doc.path ? null : path)),
                sessionId,
              );
            } else useApp.getState().fail(error);
          }
        }
        if (useApp.getState().sessionId === sessionId)
          useApp.setState((s) => ({ revision: s.revision + 1 }));
      }
      if (result.evidence.conflicts) showSurface({ kind: 'diff' }, sessionId);
      if (result.url)
        showSurface(
          { kind: 'pr', repositoryId: entry.request.repositoryId, ref: result.pullRequest },
          sessionId,
        );
      batch = {
        ...batch,
        entries: batch.entries.map((e, i) =>
          i === index ? { ...e, result, error: result.error } : e,
        ),
      };
    } catch (error) {
      batch = {
        ...batch,
        entries: batch.entries.map((e, i) =>
          i === index ? { ...e, error: error instanceof Error ? error.message : String(error) } : e,
        ),
      };
    }
    batch = { ...batch, done: index + 1 };
    update();
  }
  batch = { ...batch, phase: batch.entries.some((e) => e.error) ? 'failed' : 'completed' };
  update();
  if (batch.phase === 'completed') {
    const completed = batch;
    setTimeout(
      () =>
        useApp.setState((s) => ({
          gitBatches: {
            ...s.gitBatches,
            [sessionId]:
              s.gitBatches[sessionId] === completed ? undefined : s.gitBatches[sessionId],
          },
        })),
      3000,
    );
  }
  await useApp.getState().refreshGit(sessionId);
}

export async function createRepositoryWorktree(
  session: Session,
  repositoryIds: string[],
  branch: string,
  base: string,
) {
  if (
    useApp.getState().repositoryWorktrees[session.id] ||
    useApp.getState().gitBatches[session.id]?.phase === 'running'
  )
    throw new Error('Wait for the running Git action.');
  useApp.setState((s) => ({
    repositoryWorktrees: { ...s.repositoryWorktrees, [session.id]: { startedAt: Date.now() } },
  }));
  try {
    const paths = (useApp.getState().repositories[session.id] || [])
      .filter((r) => repositoryIds.includes(r.id))
      .map((r) => r.path);
    const { documents } = await import('~/state/editor/Documents');
    await documents.saveSession(session.id, paths);
    const created = await desktop.call('git.worktree', {
      sessionId: session.id,
      repositoryIds,
      branch,
      base,
    });
    const app = useApp.getState();
    if (app.projectId === session.projectId)
      useApp.setState((s) => ({
        sessions: [...s.sessions.filter((v) => v.id !== created.id), created],
        views: { ...s.views, [created.id]: s.views[created.id] || emptyView() },
      }));
    await useApp.getState().refreshRepositories(created.id);
    const repositories = useApp.getState().repositories[created.id] || [];
    useApp
      .getState()
      .setView(
        { repositoryIds: repositories.filter((r) => paths.includes(r.path)).map((r) => r.id) },
        created.id,
      );
    await useApp.getState().refreshGit(created.id);
    if (
      useApp.getState().sessionId === session.id &&
      useApp.getState().projectId === session.projectId
    )
      await useApp.getState().switchSession(created.id);
    return created;
  } catch (error) {
    useApp.getState().fail(error);
    throw error;
  } finally {
    useApp.setState((s) => {
      const pending = { ...s.repositoryWorktrees };
      delete pending[session.id];
      return { repositoryWorktrees: pending };
    });
  }
}
