import { randomUUID } from 'node:crypto';
import type { Action, Session, ParsedInput, Run } from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { TerminalManager } from './TerminalManager';
import { within } from '../files/paths';

export class ProjectActionService {
  constructor(
    private store: Store,
    private terminals: TerminalManager,
  ) {}
  save(input: ParsedInput<'actions.save'>) {
    if (!this.store.get('projects', input.projectId)) throw new Error('Project not found.');
    const action: Action = { ...input, id: input.id ?? randomUUID() };
    const old = this.store.get<Action>('actions', action.id);
    if (old && old.projectId !== action.projectId)
      throw new Error('This action belongs to another project.');
    this.store.put('actions', action);
    return action;
  }
  delete(id: string) {
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
    if (action?.kind === 'python') {
      file = session.python;
      args = [await within(session.path, action.command)];
      shellCommand = '';
    }
    if (action?.kind === 'django') {
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
    if (shellCommand) {
      args = ['-l', '-c', shellCommand];
      shellCommand = '';
    }
    return await this.terminals.call('run', {
      sessionId: session.id,
      cwd,
      file,
      args,
      shellCommand,
      name: action?.name || input.name,
      command: action?.command || input.command,
      previewUrl: action?.previewUrl,
    });
  }
}
