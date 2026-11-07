// Adapted from T3 Code (MIT), commit 337c5858c33bc7f8f6dfd391a2c279fa0f7e4d17.
// Copyright (c) 2026 T3 Tools Inc.
import type { ComponentProps } from 'react';

const shapes = { block: 'rounded-sm', card: 'rounded-lg', pill: 'rounded-full' };

export function Skeleton({
  className = '',
  shape = 'block',
  ...props
}: ComponentProps<'div'> & { shape?: keyof typeof shapes }) {
  return (
    <div
      className={`bg-muted-foreground/15 ${shapes[shape]} ${className}`}
      data-slot="skeleton"
      {...props}
    />
  );
}
