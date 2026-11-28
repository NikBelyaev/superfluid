import { randomUUID } from 'node:crypto';
import type { Action, Project, Session, ParsedInput, Run } from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { TerminalManager, type TerminalLaunch } from './TerminalManager';
import { within } from '../files/paths';
import { defaultAction } from '../project/defaultAction';
import { goRuntime } from '../go/goExecutables';

export class ProjectActionService {
  constructor(
    private store: Store,
    private terminals: TerminalManager,
  ) {}
  async prepare(projectId: string) {
    const project = this.store.get<Project>('projects', projectId);
    if (!project) throw new Error('Project not found.');
    const actions = this.store.projectActions(projectId);
    if (this.store.actionsReviewed(projectId)) return actions;
    if (actions.length) return this.store.completeActionSetup(projectId);
    let suggestion;
    try {
      suggestion = await defaultAction(project.path);
    } catch {
      return this.store.projectActions(projectId);
    }
    return this.store.completeActionSetup(
      projectId,
      suggestion && {
        ...suggestion,
        id: randomUUID(),
        projectId,
        shortcut: '',
        previewUrl: '',
      },
    );
  }
  save(input: ParsedInput<'actions.save'>) {
    if (!this.store.get('projects', input.projectId)) throw new Error('Project not found.');
    const action: Action = {
      ...input,
      id: input.id ?? randomUUID(),
      command: input.kind === 'go' ? 'go run .' : input.command,
    };
    const old = this.store.get<Action>('actions', action.id);
    if (old && old.projectId !== action.projectId)
      throw new Error('This action belongs to another project.');
    this.store.markActionsReviewed(action.projectId);
    this.store.put('actions', action);
    return action;
  }
  delete(id: string) {
    const action = this.store.get<Action>('actions', id);
    if (action) this.store.markActionsReviewed(action.projectId);
    this.store.deleteAction(id);
    return null;
  }
  async run(session: Session, input: ParsedInput<'terminal.run'>): Promise<Run> {
    const action = input.actionId ? this.store.get<Action>('actions', input.actionId) : undefined;
    if (input.actionId && (!action || action.projectId !== session.projectId))
      throw new Error('This action is not available in this project.');
    const cwd = await within(session.path, action?.cwd || '');
    let file = process.env.SHELL || '/bin/zsh',
      args = ['-l'],
      shellCommand = action?.command || input.command;
    let env: TerminalLaunch['env'];
    if (action?.kind === 'go') {
      const runtime = await goRuntime(this.store.directory);
      if (!runtime) throw new Error('Install Go in Settings → Languages to run this action.');
      ({ file, env } = runtime);
      args = ['run', '.'];
      shellCommand = '';
    } else if (action?.kind === 'python') {
      file = session.python;
      args = [await within(session.path, action.command)];
      shellCommand = '';
    } else if (action?.kind === 'django') {
      const url = new URL(action.previewUrl || 'http://127.0.0.1:8000');
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        throw new Error(
          'The Django preset binds to localhost. Use a shell action for another host.',
        );
      file = session.python;
      args = [
        await within(session.path, action.command),
        'runserver',
        `${url.hostname}:${url.port || '8000'}`,
      ];
      shellCommand = '';
    }
    return await this.terminals.call('run', {
      sessionId: session.id,
      cwd,
      file,
      args,
      shellCommand,
      env,
      name: action?.name || input.name,
      command: action?.command || input.command,
      previewUrl: action?.previewUrl,
    } satisfies TerminalLaunch);
  }
}
