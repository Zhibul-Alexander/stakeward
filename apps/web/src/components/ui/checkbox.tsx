import { cn } from 'cn';
import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

// shadcn/ui checkbox, classes rewritten to design tokens. The ::after layer enlarges the touch target.
function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative inline-flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface text-on-primary transition-colors after:absolute after:-inset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger data-checked:border-primary data-checked:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center">
        <CheckIcon className="size-4" aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
