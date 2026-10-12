import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui button (radix base), classes rewritten to design tokens. Focus uses the global :focus-visible outline.
//
// Hierarchy (DECISIONS.md D112): at most one filled button (primary or danger) per screen; e2e/screen-metrics.ts
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
  // v15: square-ish, regular weight, a 2 px darker bottom edge on filled buttons that disappears when pressed. Every
  // size is at least 40 px tall and icon buttons 44 px, for thumbs.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm border border-transparent font-normal whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary edge-primary mb-0.5 hover:bg-primary-hover active:translate-y-0.5 active:shadow-none',
        outline: 'bg-subtle text-foreground edge-secondary mb-0.5 hover:bg-subtle-hover active:translate-y-0.5 active:shadow-none',
        ghost: 'text-foreground underline-offset-4 hover:bg-subtle hover:underline',
        danger: 'bg-danger-solid text-on-danger edge-danger mb-0.5 hover:bg-danger-solid-hover active:translate-y-0.5 active:shadow-none',
        link: 'h-auto px-0 text-primary underline underline-offset-4 hover:text-primary-hover hover:decoration-2',
      },
      size: {
        sm: 'min-h-10 px-3 text-sm',
        md: 'min-h-11 px-4 text-sm',
        lg: 'min-h-12 px-5 text-base',
        icon: 'size-11',
        'icon-sm': 'size-10',
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
