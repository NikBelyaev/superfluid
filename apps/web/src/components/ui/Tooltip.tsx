import { useId, type ReactElement, type ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import './tooltip.css';

export function Tooltip({
  children,
  content,
  variant = 'default',
  side,
}: {
  children: ReactElement;
  content: ReactNode;
  variant?: 'default' | 'card';
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  const id = useId();
  return (
    <BaseTooltip.Provider delay={350}>
      <BaseTooltip.Root disabled={!content}>
        <BaseTooltip.Trigger
          render={children}
          closeOnClick={variant === 'card'}
          aria-describedby={content ? id : undefined}
        />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner side={side} sideOffset={6} className="ui-tooltip-positioner">
            <BaseTooltip.Popup id={id} role="tooltip" className="ui-tooltip" data-variant={variant}>
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
