import type { ComponentProps, ReactNode } from 'react';

export function MessageComposer({
  input,
  action,
  children,
  variant = 'default',
}: {
  input: ComponentProps<'textarea'>;
  action: ReactNode;
  children?: ReactNode;
  variant?: 'default' | 'embedded-dark';
}) {
  return (
    <div
      className={`message-composer relative z-1 overflow-hidden ${variant === 'embedded-dark' ? 'appearance-palette rounded-none border-0 bg-background text-foreground' : 'rounded-[var(--floating-radius)] border border-solid border-border bg-popover'}`}
      data-variant={variant}
      data-color-scheme={variant === 'embedded-dark' ? 'dark' : undefined}
    >
      <textarea
        {...input}
        className="block min-h-[84px] max-h-[260px] w-full resize-none rounded-none border-0 bg-transparent p-[var(--floating-content-inset)] text-[length:var(--text-sm)] leading-5 text-foreground outline-none [field-sizing:content]"
      />
      {children}
      <div className="flex justify-end px-2 pb-2">{action}</div>
    </div>
  );
}

export function MessageComposerSend(props: Omit<ComponentProps<'button'>, 'className'>) {
  return (
    <button
      {...props}
      className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground enabled:hover:brightness-110 aria-busy:opacity-100"
    />
  );
}
