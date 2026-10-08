import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui button (radix base), classes rewritten to design tokens. Focus uses the global :focus-visible outline.
//
// Hierarchy (DECISIONS.md D109): at most one filled button (primary or danger) per screen; e2e/screen-metrics.ts
// counts them.
//   variant   role                                                                     per screen
//   primary   the one thing to do here                                                 at most 1 filled
//   danger    replaces primary when the action removes protection or answers the F6    counts as the 1 filled
//             alarm
//   outline   every other button: alternatives, row actions, Connect when it is not   any
//             the step's goal, a step action that cannot run yet
//   ghost     Back, Refresh, copy, explorer, the row's More, "Stop waiting"            any
//   link      inline in prose                                                          any
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:bg-primary-hover',
        outline: 'border-border bg-surface text-foreground hover:bg-subtle',
        ghost: 'text-foreground hover:bg-subtle',
        danger: 'bg-danger-solid text-on-danger hover:bg-danger-solid-hover',
        link: 'h-auto px-0 text-primary underline underline-offset-4 hover:text-primary-hover',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant = 'primary', size = 'md', asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
