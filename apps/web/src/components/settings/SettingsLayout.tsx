import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Palette, Code, GitPullRequest, Bot, Info, X } from 'lucide-react';
import { SourceControlSettings } from './SourceControlSettings';
import { AboutSettings } from './AboutSettings';
import { useUpdates } from '~/state/updates';
import { AgentSettings } from './AgentSettings';
import { LanguageSettings } from './LanguageSettings';
import type { SettingsSection } from '~/state/dialogs';

const sections = [
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'languages', label: 'Languages', Icon: Code },
  { id: 'hosting', label: 'Source Control', Icon: GitPullRequest },
  { id: 'agents', label: 'Agents', Icon: Bot },
  { id: 'about', label: 'About', Icon: Info },
] as const;

export function SettingsLayout({
  children,
  section = 'appearance',
  onSectionChange,
}: {
  children: ReactNode;
  section?: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const updateAvailable = useUpdates((s) => Boolean(s.state?.availableVersion));
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
          {sections.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`settings-nav-item ${section === id ? 'active' : ''}`}
              aria-current={section === id ? 'page' : undefined}
              aria-description={
                id === 'about' && updateAvailable ? 'An update is available.' : undefined
              }
              onClick={() => onSectionChange(id)}
            >
              <Icon size={17} aria-hidden="true" />
              {label}
              {id === 'about' && updateAvailable && (
                <span
                  aria-hidden="true"
                  className="ml-auto size-1.5 shrink-0 rounded-full bg-primary"
                />
              )}
            </button>
          ))}
        </nav>
        <main
          className="min-w-0 flex-1 overflow-auto px-12 py-11 max-[900px]:px-6 max-[900px]:py-8 max-[600px]:px-4 max-[600px]:py-6"
          id={section}
        >
          <div className="mx-auto max-w-[848px]">
            {section === 'languages' ? (
              <LanguageSettings />
            ) : section === 'hosting' ? (
              <SourceControlSettings />
            ) : section === 'agents' ? (
              <AgentSettings />
            ) : section === 'about' ? (
              <AboutSettings />
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </>
  );
}
