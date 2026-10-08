import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui badge, classes rewritten to design tokens. Tones match the status colours in tokens.css; a status badge
// always carries a word and an icon too (UX rule 5), never colour alone. Status tones are a soft fill with the tone's
// text and no frame; `outline` keeps its frame (Unknown, Waiting, Not connected, Devnet). Sizes: `sm` (text-xs) in rows
// and lists, `md` (text-sm) where the badge stands on its own.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-transparent bg-neutral-soft text-neutral',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        info: 'border-transparent bg-info-soft text-info',
        danger: 'border-transparent bg-danger-soft text-danger',
        outline: 'border-border bg-surface text-foreground',
        primary: 'border-transparent bg-primary text-on-primary',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs [&>svg]:size-3.5',
        md: 'px-2.5 py-0.5 text-sm [&>svg]:size-4',
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
