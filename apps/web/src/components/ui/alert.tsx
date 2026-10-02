import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import type { ComponentProps } from 'react';

// shadcn/ui alert, classes rewritten to design tokens. Put an icon first, then AlertTitle and AlertDescription.
// Role: `alert` (assertive) for danger, `status` (polite) otherwise; pass `role` to override.
const alertVariants = cva(
  'grid w-full grid-cols-1 items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-icon *:[svg]:row-span-2 *:[svg]:mt-0.5 *:[svg]:size-4 *:[svg]:text-current',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-surface text-foreground',
        success: 'border-success-border bg-success-soft text-success',
        warning: 'border-warning-border bg-warning-soft text-warning',
        info: 'border-info-border bg-info-soft text-info',
        danger: 'border-danger-border bg-danger-soft text-danger',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
);

type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>;

function Alert({ className, tone = 'neutral', role, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      data-tone={tone}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('font-semibold', className)} {...props} />;
}

function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-sm [&_a]:underline [&_a]:underline-offset-4 [&_p:not(:last-child)]:mb-2', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
export type { AlertProps };
