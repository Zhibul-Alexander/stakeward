import { cn } from 'cn';
import { CircleAlertIcon, RotateCcwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { Disclosure } from './disclosure.tsx';

/**
 * The raw error text under a native "Details" disclosure (UX rule 8): the screen says what happened and what to do
 * next; the original message is one click away and shown as plain text.
 */
export function ErrorDetails({ detail, className }: { detail: string; className?: string | undefined }) {
  if (detail.trim() === '') return null;
  return (
    <Disclosure summary={t('common.details')} className={cn('text-sm', className)}>
      <p className="font-mono text-xs break-words whitespace-pre-wrap">{detail}</p>
    </Disclosure>
  );
}

type ErrorStateProps = {
  title: string;
  /** What happened and what to do next, in plain words. */
  message: ReactNode;
  /** Original error text for "Details". */
  detail?: string | undefined;
  /** Shown as a "Try again" button; there are no dead ends (UX rule 8). */
  onRetry?: (() => void) | undefined;
  /** Extra actions next to "Try again". */
  actions?: ReactNode;
  className?: string | undefined;
};

/** Error state shared by the product components: danger alert, message, details, a way forward. */
export function ErrorState({ title, message, detail, onRetry, actions, className }: ErrorStateProps) {
  return (
    <Alert tone="danger" className={className}>
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-foreground">
        <div>{message}</div>
        {detail === undefined ? null : <ErrorDetails detail={detail} />}
        {onRetry === undefined && actions === undefined ? null : (
          <div className="flex flex-wrap gap-2">
            {onRetry === undefined ? null : (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RotateCcwIcon aria-hidden="true" />
                {t('common.tryAgain')}
              </Button>
            )}
            {actions}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
