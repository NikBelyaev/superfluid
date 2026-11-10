import { CodexSettings } from '~/components/agents/codex/CodexSettings';
import { T3Settings } from '~/components/agents/t3/T3Settings';

export function AgentSettings() {
  return (
    <>
      <h1 className="mt-0 mb-2 text-2xl font-semibold">Agents</h1>
      <p className="text-muted-foreground">Follow coding agents working in your projects.</p>
      <CodexSettings />
      <T3Settings />
    </>
  );
}
