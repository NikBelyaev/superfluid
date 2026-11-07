import { useId, type ReactElement, type ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import './tooltip.css';

export function Tooltip({ children, content }: { children: ReactElement; content: ReactNode }) {
  const id = useId();
  return (
    <BaseTooltip.Provider delay={350}>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger render={children} closeOnClick={false} aria-describedby={id} />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner sideOffset={6} className="ui-tooltip-positioner">
            <BaseTooltip.Popup id={id} role="tooltip" className="ui-tooltip">
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
