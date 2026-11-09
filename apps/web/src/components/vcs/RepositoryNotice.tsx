import type { ReactNode } from 'react';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';

export function RepositoryNotice({
  tone,
  children,
}: {
  tone: 'error' | 'warning' | 'info';
  children: ReactNode;
}) {
  const Icon = { error: CircleAlert, warning: TriangleAlert, info: Info }[tone];
  return (
    <div
      className="repository-notice"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon size={15} aria-hidden />
      <div>{children}</div>
    </div>
  );
}
