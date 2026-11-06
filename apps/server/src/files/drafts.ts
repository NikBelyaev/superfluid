import type { Session } from '@superfluid/contracts';
import type { Store } from '../persistence/Store';

export function assertNoDrafts(store: Store, session: Session, path: string) {
  const drafts = store
    .drafts(session.id)
    .filter((d) => !path || d.path === path || d.path.startsWith(path + '/'));
  if (drafts.length)
    throw new Error(
      'Save or discard the unsaved recovery drafts first: ' +
        drafts
          .slice(0, 5)
          .map((d) => d.path)
          .join(', '),
    );
}
