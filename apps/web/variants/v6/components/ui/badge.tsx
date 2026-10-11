import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui badge, classes rewritten to design tokens. Tones match the status colours in tokens.css; a status badge
// always carries a word and an icon too (UX rule 5), never colour alone. Status tones are a soft fill with the tone's
// text and no frame; `outline` keeps its frame (Unknown, Waiting, Not connected, Devnet). Sizes: `sm` (text-xs) in rows
// and lists, `md` (text-sm) where the badge stands on its own.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-none border-2 font-bold uppercase tracking-wider whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-foreground bg-background text-foreground',
        success: 'border-signal bg-signal text-on-signal',
        warning: 'border-signal bg-background text-foreground',
        info: 'border-foreground bg-foreground text-background',
        danger: 'border-danger-solid bg-danger-solid text-on-danger',
        outline: 'border-foreground bg-background text-foreground',
        primary: 'border-foreground bg-foreground text-background',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[0.6875rem] leading-4 [&>svg]:size-3.5',
        md: 'px-2 py-1 text-xs [&>svg]:size-4',
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
