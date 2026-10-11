import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui badge, classes rewritten to design tokens. Tones match the status colours in tokens.css; a status badge
// always carries a word and an icon too (UX rule 5), never colour alone. Status tones are a soft fill with the tone's
// text and no frame; `outline` keeps its frame (Unknown, Waiting, Not connected, Devnet). Sizes: `sm` (text-xs) in rows
// and lists, `md` (text-sm) where the badge stands on its own.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-none border font-medium tabular-nums whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-neutral-border bg-transparent text-neutral',
        success: 'border-success-border bg-success-soft text-success',
        warning: 'border-warning-border bg-warning-soft text-warning',
        info: 'border-info-border bg-info-soft text-info',
        danger: 'border-danger-border bg-danger-soft text-danger',
        outline: 'border-border-strong bg-transparent text-foreground',
        primary: 'border-primary bg-primary text-on-primary',
      },
      size: {
        sm: 'px-1.5 py-px text-xs [&>svg]:size-3.5',
        md: 'px-2 py-0.5 text-sm [&>svg]:size-4',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'sm',
    },
  },
);

type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean };

function Badge({ className, tone = 'neutral', size = 'sm', asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span';
  return (
    <Comp
      data-slot="badge"
      data-tone={tone}
      data-size={size}
      className={cn(badgeVariants({ tone, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
export type { BadgeProps };
