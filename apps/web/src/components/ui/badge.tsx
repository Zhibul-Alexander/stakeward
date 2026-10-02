import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui badge, classes rewritten to design tokens. Tones match the status colours in tokens.css; a status badge
// always carries a word and an icon too (UX rule 5), never colour alone.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3.5 [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-neutral-border bg-neutral-soft text-neutral',
        success: 'border-success-border bg-success-soft text-success',
        warning: 'border-warning-border bg-warning-soft text-warning',
        info: 'border-info-border bg-info-soft text-info',
        danger: 'border-danger-border bg-danger-soft text-danger',
        outline: 'border-border bg-surface text-foreground',
        primary: 'border-transparent bg-primary text-on-primary',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean };

function Badge({ className, tone = 'neutral', asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span';
  return <Comp data-slot="badge" data-tone={tone} className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
export type { BadgeProps };
