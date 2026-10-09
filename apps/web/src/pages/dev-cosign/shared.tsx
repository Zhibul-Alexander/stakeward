import { formatUtcDate } from '@stakeward/core';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/** One numbered step of the page (h2). */
export function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-col gap-1 border-b border-border pb-2">
        <h2 id={`${id}-title`} className="text-2xl font-semibold">
          {title}
        </h2>
        {intro === undefined ? null : <p className="text-sm text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

/** `14:13:05 UTC on 2 October 2026`: dev locks last minutes, so the time matters. */
export function formatUtcDateTime(unixSeconds: bigint): string {
  const date = formatUtcDate(unixSeconds);
  if (date === null) return unixSeconds.toString();
  const at = new Date(Number(unixSeconds) * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
  return t('devCosign.dateTime', { time, date });
}

type CopyState = 'idle' | 'copied' | 'failed';

/** Copies plain text; says so politely, and tells the user to select it by hand when the clipboard is unavailable. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<CopyState>('idle');
  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => {
      setState('idle');
    }, 2000);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void (async () => {
            try {
              if (!('clipboard' in navigator)) throw new Error('Clipboard unavailable');
              await navigator.clipboard.writeText(text);
              setState('copied');
            } catch {
              setState('failed');
            }
          })();
        }}
      >
        {state === 'copied' ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {label}
      </Button>
      <span role="status" className={state === 'failed' ? 'text-sm text-danger' : 'sr-only'}>
        {state === 'copied' ? t('common.copied') : state === 'failed' ? t('devCosign.reports.copyFailed') : ''}
      </span>
    </span>
  );
}

/** A plain-text report with its copy button. The text is selectable and scrolls by keyboard. */
export function ReportBlock({ text, label }: { text: string; label: string }) {
  return (
    <figure data-slot="report" className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
        {label}
        <CopyButton text={text} label={t('devCosign.reports.copy')} />
      </figcaption>
      <pre
        tabIndex={0}
        aria-label={label}
        className="max-h-96 overflow-y-auto rounded-md border border-border bg-subtle p-3 font-mono text-xs break-all whitespace-pre-wrap"
      >
        {text}
      </pre>
    </figure>
  );
}
