import { z } from 'zod';

// Increment when an older release can no longer read persisted workspace data.
export const WORKSPACE_DATA_VERSION = 1;
export const RELEASE_REPOSITORY = 'NikBelyaev/superfluid';
export const updateChannel = z.enum(['stable', 'nightly']);
export type UpdateChannel = z.infer<typeof updateChannel>;
export const updateRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('state') }),
  z.object({ action: z.literal('check') }),
  z.object({ action: z.literal('download') }),
  z.object({ action: z.literal('install') }),
  z.object({ action: z.literal('channel'), channel: updateChannel }),
]);
export type UpdateRequest = z.infer<typeof updateRequest>;
export interface UpdateState {
  version: string;
  channel: UpdateChannel;
  status:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error';
  availableVersion: string | null;
  progress: number | null;
  releaseNotes: string;
  message: string;
}
