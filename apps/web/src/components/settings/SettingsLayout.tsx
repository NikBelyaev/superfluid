import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Palette, X } from 'lucide-react';

export function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="flex h-(--workspace-topbar-height) shrink-0 items-center justify-between border-b border-border px-6">
        <Dialog.Title className="m-0 text-sm font-semibold">Settings</Dialog.Title>
        <Dialog.Close className="icon-button" aria-label="Close settings">
          <X size={17} />
        </Dialog.Close>
      </header>
      <div className="flex min-h-0 flex-1 max-[600px]:flex-col">
        <nav
          className="w-52 shrink-0 border-r border-border bg-sidebar px-3 py-6 max-[900px]:w-44 max-[600px]:w-auto max-[600px]:border-r-0 max-[600px]:border-b max-[600px]:px-4 max-[600px]:py-2"
          aria-label="Settings"
        >
          <a
            className="flex items-center gap-2.5 rounded-md bg-accent px-3.5 py-2 font-medium text-foreground no-underline"
            href="#appearance"
            aria-current="page"
          >
            <Palette size={17} />
            Appearance
          </a>
        </nav>
        <main
          className="min-w-0 flex-1 overflow-auto px-12 py-11 max-[900px]:px-6 max-[900px]:py-8 max-[600px]:px-4 max-[600px]:py-6"
          id="appearance"
        >
          <div className="mx-auto max-w-[848px]">{children}</div>
        </main>
      </div>
    </>
  );
}
