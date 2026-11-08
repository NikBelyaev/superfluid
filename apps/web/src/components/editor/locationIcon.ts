import {
  Box,
  Braces,
  FileCode2,
  KeyRound,
  Package,
  SquareFunction,
  Tag,
  Variable,
  type LucideIcon,
} from 'lucide-react';
import type { Location } from '~/state/workspaceView';

// LSP SymbolKind values.
const symbolIcons: Partial<Record<number, LucideIcon>> = {
  2: Package,
  3: Package,
  5: Box,
  6: Braces,
  7: Tag,
  9: Braces,
  12: SquareFunction,
  13: Variable,
  14: KeyRound,
};

export const locationIcon = (location: Pick<Location, 'symbol' | 'symbolKind'>) =>
  symbolIcons[location.symbolKind ?? 0] ?? (location.symbol ? Braces : FileCode2);
