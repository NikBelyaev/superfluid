import type { Method, Input, Results } from './rpc';
import type { AppEvent } from './events';
import type { Project } from './project';
import type { UpdateRequest, UpdateState } from './updates';

export interface Bridge {
  update(input: UpdateRequest): Promise<UpdateState>;
  onUpdate(listener: (state: UpdateState) => void): () => void;
  onShowUpdates(listener: () => void): () => void;
  call<M extends Method>(method: M, input: Input<M>): Promise<Results[M]>;
  onEvent(listener: (event: AppEvent) => void): () => void;
  onFlush(listener: () => Promise<void>): () => void;
  chooseProject(): Promise<Project | null>;
  chooseDirectory(): Promise<string | null>;
  exportText(text: string, name: string): Promise<boolean>;
  trash(sessionId: string, path: string): Promise<void>;
  copyFile(sessionId: string, path: string): Promise<void>;
  copyText(text: string): Promise<void>;
  external(url: string): Promise<void>;
  browser(input: {
    url?: string;
    bounds?: { x: number; y: number; width: number; height: number };
    visible: boolean;
  }): Promise<void>;
}

declare global {
  interface Window {
    superfluid: Bridge;
  }
}
