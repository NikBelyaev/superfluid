import type { PythonStatus } from '@superfluid/contracts';

const generations = new Map<string, number>();
const ready = new Set<string>();
const listeners = new Set<(sessionId: string) => void>();

export const pythonGeneration = (sessionId: string) => generations.get(sessionId) ?? 0;
export const pythonReady = (sessionId: string) => ready.has(sessionId);

export function acceptPythonStatus(event: PythonStatus) {
  const current = pythonGeneration(event.sessionId);
  if (event.generation < current) return false;
  generations.set(event.sessionId, event.generation);
  if (event.phase === 'ready') ready.add(event.sessionId);
  else ready.delete(event.sessionId);
  if (event.generation !== current) for (const listener of listeners) listener(event.sessionId);
  return true;
}

export function assertPythonGeneration(sessionId: string, generation: number) {
  if (generation !== pythonGeneration(sessionId))
    throw new Error('Python environment changed. Try again.');
}

export function onPythonReset(listener: (sessionId: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
