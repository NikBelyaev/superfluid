import {
  requests,
  type Method,
  type Input,
  type ParsedInput,
  type Results,
  type AppEvent,
} from '@superfluid/contracts';
import { Store } from '../persistence/Store';
import { FileService } from '../files/FileService';
import { DocumentService } from '../files/DocumentService';
import { GitService } from '../vcs/GitService';
import { SourceControlService } from '../vcs/SourceControlService';
import { ProjectService } from '../project/ProjectService';
import { LanguageServers } from '../python/LanguageServers';
import { PythonService } from '../python/PythonService';
import { TerminalManager } from '../terminal/TerminalManager';
import { ProjectActionService } from '../terminal/ProjectActionService';
import { PullRequestService } from '../pullRequest/PullRequestService';
import { HostingService } from '../hosting/HostingService';
import { SourceControlDiscovery } from '../hosting/SourceControlDiscovery';
import { WorkspaceWatcher } from './WorkspaceWatcher';
import { createWorkspaceHandlers, type WorkspaceHandlers } from '../rpc/WorkspaceHandlers';

export class Workspace {
  readonly store: Store;
  readonly files = new FileService();
  readonly git: GitService;
  readonly lsp: LanguageServers;
  readonly terminals: TerminalManager;
  readonly projects: ProjectService;
  readonly documents: DocumentService;
  readonly sourceControl: SourceControlService;
  readonly actions: ProjectActionService;
  readonly python: PythonService;
  readonly pullRequests: PullRequestService;
  readonly hosting: HostingService;
  readonly sourceControlDiscovery: SourceControlDiscovery;
  private watcher: WorkspaceWatcher;
  private handlers: WorkspaceHandlers;
  constructor(
    directory: string,
    emit: (event: AppEvent) => void,
    options: { terminalWorker?: URL } = {},
  ) {
    this.store = new Store(directory);
    this.sourceControlDiscovery = new SourceControlDiscovery(directory);
    this.hosting = new HostingService(this.store, undefined, this.sourceControlDiscovery);
    this.git = new GitService(
      this.store,
      (operation) => emit({ type: 'operation', operation }),
      this.hosting,
    );
    this.lsp = new LanguageServers(this.store, emit);
    this.terminals = new TerminalManager(emit, options.terminalWorker);
    this.projects = new ProjectService(this.store, this.lsp, (project) =>
      emit({ type: 'project', project }),
    );
    this.watcher = new WorkspaceWatcher(this.lsp, emit);
    this.documents = new DocumentService(this.files, this.store, this.watcher);
    this.sourceControl = new SourceControlService(this.git, this.projects, this.store);
    this.actions = new ProjectActionService(this.store, this.terminals);
    this.python = new PythonService(this.lsp, this.watcher, this.files, this.documents);
    this.pullRequests = new PullRequestService(this.hosting, (sessionId, ref) =>
      emit({ type: 'pr.changed', sessionId, ref }),
    );
    this.handlers = createWorkspaceHandlers(this);
  }
  async call<M extends Method>(method: M, raw: Input<M>): Promise<Results[M]> {
    if (!(method in requests)) throw new Error('Unknown workspace operation.');
    const input = requests[method].parse(raw) as ParsedInput<M>;
    return this.handlers[method](input);
  }
  async close() {
    this.watcher.close();
    this.lsp.close();
    await this.terminals.close();
    this.store.close();
  }
}
