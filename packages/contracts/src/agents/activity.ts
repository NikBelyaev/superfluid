export type AgentActivity = 'thinking' | 'read' | 'search' | 'edit' | 'command' | 'test' | 'tool';

export interface AgentStep {
  id: string;
  activity: AgentActivity;
  label: string;
  detail: string;
  startedAt: number;
  endedAt?: number;
  outcome?: 'completed' | 'failed' | 'stopped';
}

export interface Agent {
  id: string;
  threadId: string;
  runId?: string;
  sessionId: string;
  model: string;
  title?: string;
  message?: string;
  status: 'idle' | 'queued' | 'working' | 'needs-input' | 'done' | 'stopped' | 'failed';
  startedAt: number;
  updatedAt: number;
  steps: AgentStep[];
  files?: string[];
  question?: { id: string; questions: { title: string; options?: string[] | null }[] };
  approval?: {
    id: string;
    label: string;
    detail: string;
    reason?: string;
    activity: AgentActivity;
    startedAt: number;
  };
}
