import { commandDisplayLines, commandLine } from '@stakeward/core';
import { cn } from 'cn';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCopy } from '@/hooks/use-copy';
import { t } from '@/i18n';

/** A word the reader replaces, like `<MAIN_KEY>` (core RECOVERY_PLACEHOLDERS); the capture keeps it in split(). */
const PLACEHOLDER = /(<[A-Z_]+>)/;

type CommandBlockProps = {
  /** The command as an argv (core recoveryCommands): shown as commandDisplayLines, copied as commandLine. */
  argv: readonly string[];
  /** What the command does, for the copy button's name ("Copy the command: {label}"). */
  label: string;
  className?: string | undefined;
};

/**
 * A command line to type or copy (the recovery card). Shown over several lines with ` \` continuations, wrapping
 * anywhere on a narrow screen and on paper, so nothing is cut off and the page never scrolls sideways. Placeholders
 * stand out in bold. Copy puts the one-line form on the clipboard: it works in bash, zsh, PowerShell and cmd alike.
 * Plain text only.
 */
export function CommandBlock({ argv, label, className }: CommandBlockProps) {
  const { state, copy } = useCopy();
  const lines = commandDisplayLines(argv);
  return (
    <div
      data-slot="command-block"
      className={cn('flex items-start gap-1 rounded-md border border-border bg-subtle print:break-inside-avoid', className)}
    >
      <pre className="min-w-0 flex-1 p-3 font-mono text-xs whitespace-pre-wrap wrap-anywhere sm:text-sm">
        <code>
          {lines.map((line, index) => (
            <Fragment key={index}>
              {index === 0 ? null : '\n'}
              {line.split(PLACEHOLDER).map((part, partIndex) =>
                PLACEHOLDER.test(part) ? (
                  <span key={partIndex} className="font-semibold text-primary">
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
            </Fragment>
          ))}
        </code>
      </pre>
      <div className="flex shrink-0 flex-col items-end gap-1 p-1 print:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted hover:text-foreground"
          aria-label={t('components.command.copy', { label })}
          onClick={() => {
            copy(commandLine(argv));
          }}
        >
          {state === 'copied' ? <CheckIcon aria-hidden="true" className="text-success" /> : <CopyIcon aria-hidden="true" />}
        </Button>
        {state === 'failed' ? (
          <span aria-hidden="true" className="px-1 text-xs whitespace-nowrap text-danger">
            {t('components.address.copyFailedShort')}
          </span>
        ) : null}
      </div>
      {/* Announces the result politely; the visible feedback is the check icon or the short failure text. */}
      <span role="status" className="sr-only">
        {state === 'copied' ? t('components.command.copied') : state === 'failed' ? t('components.command.copyFailed') : ''}
      </span>
    </div>
  );
}

/** Loading state: the footprint of a three-line command. */
export function CommandBlockSkeleton({ className }: { className?: string | undefined }) {
  return <Skeleton className={cn('h-20 w-full', className)} />;
}
