import { useLayoutEffect } from 'react';
import { resolveAppearance, useAppearance, useSystemDark } from '~/state/appearance';

export function useAppearanceSync() {
  const appearance = useAppearance(),
    systemDark = useSystemDark();
  const { scheme } = resolveAppearance(appearance, systemDark);
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => useSystemDark.setState(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.colorScheme = scheme;
  }, [scheme]);
}
