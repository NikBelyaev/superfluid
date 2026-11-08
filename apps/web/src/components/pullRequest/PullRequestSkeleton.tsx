import { Skeleton } from '~/components/ui/Skeleton';

export function PullRequestSkeleton() {
  return (
    <div
      className="surface-content pr-surface pr-detail"
      role="status"
      aria-label="Loading request"
    >
      <div className="flex flex-col gap-4 p-4" aria-hidden>
        <div className="flex items-center gap-2">
          <Skeleton shape="pill" className="h-4 w-32" />
          <Skeleton shape="pill" className="h-4 w-12" />
        </div>
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-3 w-40" />
        <div className="flex gap-2 py-2">
          <Skeleton shape="pill" className="h-4 w-24" />
          <Skeleton shape="pill" className="h-4 w-28" />
        </div>
        <Skeleton shape="pill" className="h-8 w-64 max-w-full" />
        <div className="flex flex-col gap-3 py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </div>
  );
}

export function PullRequestDiscussionSkeleton({ timeline = false }: { timeline?: boolean }) {
  return (
    <div role="status" aria-label={timeline ? 'Loading timeline' : 'Loading comments'}>
      <div className="flex flex-col gap-5 py-2" aria-hidden>
        {[0, 1, 2].map((row) => (
          <div className="flex items-start gap-3" key={row}>
            <Skeleton shape="pill" className="size-6 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PullRequestCodeSkeleton() {
  return (
    <div role="status" aria-label="Loading diff">
      <div className="flex flex-col gap-3 p-4" aria-hidden>
        <Skeleton className="mb-4 h-5 w-48" />
        {['w-3/4', 'w-5/6', 'w-1/2', 'w-2/3', 'w-5/6', 'w-3/4'].map((width, row) => (
          <div className="flex gap-4" key={row}>
            <Skeleton className="h-3 w-6 shrink-0" />
            <Skeleton className={`h-3 ${width}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
