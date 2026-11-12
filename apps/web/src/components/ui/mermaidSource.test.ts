import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeSequenceMessageSemicolons } from './mermaidSource';

test('sequence message semicolons are escaped without changing entities or other diagram syntax', () => {
  const source = [
    'sequenceDiagram',
    'autonumber',
    'participant R as Receiver',
    'participant Q as Redis',
    'participant A as Archive',
    'R->>Q: distribute_messages (сбой отправки — лог; затем возможен ack)',
    'Q-->>A: пачка сообщений',
    'A->>A: CreateEventArchive (MessageArchive?; skip_save_message; StaticEventArchive)',
    'Note over R,Q: Сохранить #59; и #quot; как есть; продолжить',
  ].join('\n');
  assert.equal(
    escapeSequenceMessageSemicolons(source),
    source
      .replace('лог;', 'лог#59;')
      .replace('MessageArchive?;', 'MessageArchive?#59;')
      .replace('skip_save_message;', 'skip_save_message#59;')
      .replace('как есть;', 'как есть#59;'),
  );
  assert.equal(
    escapeSequenceMessageSemicolons('flowchart LR\nA[one; two] --> B'),
    'flowchart LR\nA[one; two] --> B',
  );
  assert.equal(
    escapeSequenceMessageSemicolons('sequenceDiagram\nparticipant A as One; participant B as Two'),
    'sequenceDiagram\nparticipant A as One; participant B as Two',
  );
});
