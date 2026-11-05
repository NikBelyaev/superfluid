import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';

export function useActiveTab(key: string) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const reveal = () =>
      element
        .querySelector<HTMLElement>('[aria-selected="true"]')
        ?.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);
  return list;
}

// Editor tabs activate on Enter so arrow navigation does not move focus into Monaco.
export function navigateTabs(event: KeyboardEvent, activate = false) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const index = tabs.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  if (activate) tabs[next].click();
  tabs[next].focus();
}
