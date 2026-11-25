import { Skeleton } from '~/components/ui/Skeleton';

export function HistorySkeleton({ showRepository = false }: { showRepository?: boolean }) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden" role="status" aria-label="Loading Git history">
      <div className="motion-safe:animate-skeleton" aria-hidden="true">
        {Array.from({ length: 14 }, (_, row) => (
          <div
            key={row}
            className="flex h-9 items-center border-0 border-b border-solid border-border/60 ps-1 pe-3"
          >
            {showRepository && (
              <div className="me-0.5 flex w-20 shrink-0 justify-end @max-[480px]/history:w-16">
                <Skeleton shape="pill" className="h-5 w-14 max-w-full" />
              </div>
            )}
            <div className="relative flex h-full w-3.5 shrink-0 items-center justify-center">
              <Skeleton className="absolute inset-y-0 w-px" />
              <Skeleton shape="pill" className="relative size-2" />
            </div>
            <Skeleton
              className={`ms-2 h-3 min-w-0 ${row % 3 === 0 ? 'w-56' : row % 3 === 1 ? 'w-40' : 'w-64'}`}
            />
            <div className="ms-auto flex shrink-0 items-center gap-2">
              <Skeleton className="h-3 w-16 @max-[540px]/history:hidden" />
              <Skeleton className="h-3 w-12 @max-[360px]/history:hidden" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
