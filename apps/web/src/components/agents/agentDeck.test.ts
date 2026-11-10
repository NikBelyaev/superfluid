import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attentionKey,
  pickAgent,
  requestKey,
  runKey,
  validDetail,
  type AgentCard,
} from './agentPriority';

const card = (key: string, status: AgentCard['agent']['status'], updatedAt: number): AgentCard => ({
  key,
  name: 'Codex',
  icon: null,
  agent: {
    id: key,
    threadId: key,
    sessionId: 'worktree',
    model: 'Codex',
    runId: 'one',
    status,
    startedAt: 1,
    updatedAt,
    steps: [],
    ...(status === 'needs-input'
      ? {
          approval: {
            id: 'request-' + key,
            activity: 'command',
            label: 'Allow?',
            detail: 'git push',
            startedAt: updatedAt,
          },
        }
      : {}),
  },
  onRespond: async () => {},
  onOpenRun: async () => {},
  onDismiss: () => {},
  message: () => null,
  onQueue: async () => {},
});

test('agent priority is request, unread completion, working, then queued with deferred requests retained', () => {
  const queued = card('queued', 'queued', 2),
    working = card('working', 'working', 3),
    done = card('done', 'done', 4),
    request = card('request', 'needs-input', 5),
    next = card('next', 'needs-input', 6);
  const cards = [queued, working, done, request, next];
  const state = { selected: queued.key, focus: null, detail: null, skipped: [], seen: [] };
  assert.equal(pickAgent(cards, state)?.key, request.key);
  const skipped = [requestKey(request), requestKey(next)];
  assert.equal(pickAgent(cards, { ...state, skipped })?.key, done.key);
  assert.equal(pickAgent(cards, { ...state, skipped, seen: [runKey(done)] })?.key, working.key);
  assert.equal(pickAgent([queued], state)?.key, queued.key);
});

test('selection yields to new escalations while an open detail stays with its own run', () => {
  const first = card('first', 'working', 1),
    second = card('second', 'working', 2);
  const focus = { key: second.key, attention: attentionKey([first, second]) };
  const state = { selected: second.key, focus, detail: null, skipped: [], seen: [] };
  assert.equal(pickAgent([first, second], state)?.key, second.key);
  const done = { ...first, agent: { ...first.agent, status: 'done' as const } };
  assert.equal(pickAgent([done, second], state)?.key, first.key);
  const detail = { key: second.key, run: runKey(second), mode: 'history' as const };
  assert.equal(pickAgent([done, second], { ...state, detail })?.key, second.key);
  assert.equal(validDetail([done], detail), null);
  assert.equal(
    validDetail([{ ...second, agent: { ...second.agent, runId: 'two' } }], detail),
    null,
  );
  const question = card('question', 'needs-input', 3);
  question.agent.question = {
    id: 'question-one',
    questions: [{ title: 'What should we explore?' }],
  };
  delete question.agent.approval;
  const reply = {
    key: question.key,
    run: runKey(question),
    mode: 'message' as const,
    returnTo: 'request' as const,
  };
  assert.equal(validDetail([question], reply), reply);
  assert.equal(
    validDetail([{ ...question, agent: { ...question.agent, status: 'queued' } }], reply),
    null,
  );
  assert.ok(requestKey(question).endsWith(':question-one'));
});

test('collapsing keeps the last selected agent within each priority tier', () => {
  for (const status of ['done', 'stopped', 'failed', 'working', 'queued', 'needs-input'] as const) {
    const first = card('first', status, 2),
      second = card('second', status, 3);
    const state = {
      selected: second.key,
      focus: null,
      detail: null,
      seen: [runKey(first), runKey(second)],
      skipped: [requestKey(first), requestKey(second)],
    };
    assert.equal(pickAgent([first, second], state)?.key, second.key, status);
    assert.equal(pickAgent([first], state)?.key, first.key, 'dismissed selection');
    assert.equal(pickAgent([first, second, card('new', 'needs-input', 4)], state)?.key, 'new');
  }
});
