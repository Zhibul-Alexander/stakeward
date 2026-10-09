import { cn } from 'cn';
import { Loader2Icon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { t } from '@/i18n';

// shadcn/ui spinner, classes rewritten to design tokens. Under prefers-reduced-motion it stands still.
function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={t('common.loading')}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
