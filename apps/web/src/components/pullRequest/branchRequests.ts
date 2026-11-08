import { create } from 'zustand';
import type { Page, PullRequestSummary } from '@superfluid/contracts';

export interface BranchRequestResult {
  identity: string;
  page?: Page<PullRequestSummary>;
  error?: string;
}
type Results = Record<string, BranchRequestResult>;
export const emptyBranchRequests: Results = {};
export const useBranchRequests = create<{ sessions: Record<string, Results> }>(() => ({
  sessions: {},
}));

export function updateBranchRequests(sessionId: string, update: (results: Results) => Results) {
  useBranchRequests.setState((state) => ({
    sessions: {
      ...state.sessions,
      [sessionId]: update(state.sessions[sessionId] ?? emptyBranchRequests),
    },
  }));
}
