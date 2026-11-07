import { Skeleton } from '~/components/ui/Skeleton';

export function SettingsSkeleton() {
  return (
    <div role="status" aria-label="Loading appearance settings">
      <div className="motion-safe:animate-skeleton" aria-hidden="true">
        <div className="flex h-8 items-start">
          <Skeleton shape="pill" className="h-7 w-40" />
        </div>
        <div className="mt-8">
          <Skeleton shape="pill" className="mb-4 h-6 w-28" />
          <div className="grid grid-cols-3 gap-3 max-[600px]:gap-2">
            {['system', 'light', 'dark'].map((scheme) => (
              <div className="rounded-xl border border-border p-2 max-[600px]:p-[5px]" key={scheme}>
                <Skeleton shape="card" className="aspect-[1.85]" />
                <div className="flex h-[26px] items-center justify-center">
                  <Skeleton shape="pill" className="h-3 w-12" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-8">
          <Skeleton shape="pill" className="mb-1.5 h-6 w-20" />
          <Skeleton shape="pill" className="mb-6 h-5 w-72 max-w-full" />
          <div className="grid grid-cols-2 gap-3">
            {['darcula', 'monaco'].map((theme) => (
              <div
                className="rounded-xl border border-border px-4 pt-5 pb-3 max-[600px]:px-2"
                key={theme}
              >
                <div className="flex justify-center gap-7 max-[600px]:gap-5">
                  {['light', 'dark'].map((scheme) => (
                    <div className="flex flex-col items-center gap-2.5" key={scheme}>
                      <Skeleton shape="pill" className="size-14 max-[600px]:size-[46px]" />
                      <div className="flex h-5 items-center">
                        <Skeleton shape="pill" className="h-3 w-8" />
                      </div>
                    </div>
                  ))}
                </div>
                <Skeleton shape="pill" className="mt-[18px] h-5 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
