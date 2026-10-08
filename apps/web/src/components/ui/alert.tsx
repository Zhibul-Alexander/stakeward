import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import type { ComponentProps } from 'react';

// shadcn/ui alert, classes rewritten to design tokens. Put an icon first, then AlertTitle and AlertDescription.
// Role: `alert` (assertive) for danger, `status` (polite) otherwise; pass `role` to override.
// A soft fill without a frame for every tone but danger: danger is the only framed alert, the one "shout" on a screen.
// `size="lg"` is the /cosign stop panel: a thicker frame, larger icon and text.
const alertVariants = cva(
  'grid w-full grid-cols-1 items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-icon *:[svg]:row-span-2 *:[svg]:mt-0.5 *:[svg]:size-4 *:[svg]:text-current',
  {
    variants: {
      tone: {
        neutral: 'border-transparent bg-subtle text-foreground',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        info: 'border-transparent bg-info-soft text-info',
        danger: 'border-danger-border bg-danger-soft text-danger',
      },
      size: {
        md: '',
        lg: 'border-2 px-5 py-4 text-base *:[svg]:size-6',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'md',
    },
  },
);

type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>;

function Alert({ className, tone = 'neutral', size = 'md', role, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      data-tone={tone}
      data-size={size}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cn(alertVariants({ tone, size }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('font-semibold', className)} {...props} />;
}

/**
 * Its text size comes from the Alert (text-sm, text-base at `size="lg"`), so the stop panel's body grows with its title.
 * Prose links stay underlined (WCAG 1.4.1); a button rendered as a link (data-slot="button") does not.
 */
function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        '[&_a:not([data-slot=button])]:underline [&_a:not([data-slot=button])]:underline-offset-4 [&_p:not(:last-child)]:mb-2',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
export type { AlertProps };
