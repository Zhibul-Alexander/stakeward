import { cn } from 'cn';
import type { ComponentProps } from 'react';

// shadcn/ui textarea, classes rewritten to design tokens (the same frame as Input). text-base on small screens keeps
// mobile browsers from zooming.
function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-24 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
