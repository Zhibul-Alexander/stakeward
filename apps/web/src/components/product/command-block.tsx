import { commandDisplayLines, commandLine } from '@stakeward/core';
import { cn } from 'cn';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';
import { useCopy, type CopyState } from './use-copy.ts';

type CommandBlockProps = {
  /** The command as core builds it (`recoveryCommands`, `LEDGER_PUBKEY_COMMAND`). */
  argv: readonly string[];
  /** What the command does; names the group and its copy button. */
  label: string;
  className?: string | undefined;
  /** /dev/ui only: shows this copy feedback without pressing the button (it is otherwise there for 2 s). */
  feedback?: CopyState | undefined;
};

/**
 * A Solana CLI command of the recovery card (DECISIONS.md D75): one line per argument, every line but the last ending
 * in ` \`, as bash and zsh accept it; the copy button copies it as one line. Plain text only. States: idle, copied,
 * copy failed (the error state) and CommandBlockSkeleton (loading); there is no empty command.
 */
export function CommandBlock({ argv, label, className, feedback }: CommandBlockProps) {
  const copier = useCopy();
  const state = feedback ?? copier.state;

  return (
    <div role="group" aria-label={label} data-slot="command-block" className={cn('flex flex-col gap-1 print:break-inside-avoid', className)}>
      <div className="flex items-start gap-1">
        <pre className="min-w-0 flex-1 rounded-md border border-border bg-subtle p-3 font-mono text-sm whitespace-pre-wrap wrap-anywhere print:break-inside-avoid">
          {commandDisplayLines(argv).join('\n')}
        </pre>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted hover:text-foreground print:hidden"
          aria-label={t('components.command.copy', { label })}
          onClick={() => {
            void copier.copy(commandLine(argv));
          }}
        >
          {state === 'copied' ? <CheckIcon aria-hidden="true" className="text-success" /> : <CopyIcon aria-hidden="true" />}
        </Button>
      </div>
      {/* Announces the result politely; the visible feedback is the check icon or the short failure text. */}
      <span role="status" className="sr-only">
        {state === 'copied' ? t('components.command.copied') : state === 'failed' ? t('components.command.copyFailed') : ''}
      </span>
      {state === 'failed' ? (
        <span aria-hidden="true" className="self-end text-xs text-danger print:hidden">
          {t('components.address.copyFailedShort')}
        </span>
      ) : null}
    </div>
  );
}

/** Loading state: the footprint of a few command lines, decorative (the surrounding region announces loading). */
export function CommandBlockSkeleton() {
  return <Skeleton className="h-28 w-full" />;
}
