import { aiPromptUrl, type AiProvider } from '@stakeward/core';
import { cn } from 'cn';
import { CopyIcon, ExternalLinkIcon, MessageSquareTextIcon } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { Disclosure } from './disclosure.tsx';
import { useCopy } from './use-copy.ts';

export type AskAiProps = {
  /** The whole question (core `aiPrompt`): public data only. */
  prompt: string;
  /** The line under the title; the default says the page is checked against the network. */
  body?: string | undefined;
  className?: string | undefined;
};

/** A new tab that cannot reach back into this page or learn where it came from. */
const NEW_TAB_REL = 'noopener noreferrer';

const PROVIDERS: readonly { provider: AiProvider; label: 'askAi.chatgpt' | 'askAi.claude' }[] = [
  { provider: 'chatgpt', label: 'askAi.chatgpt' },
  { provider: 'claude', label: 'askAi.claude' },
];

/**
 * "Ask your AI" (DECISIONS.md D122): the question opens in the person's own ChatGPT or Claude account, or is copied.
 * Plain links: no request from this page, no key, nothing stored (CSP connect-src stays 'self'). The AI explains; the
 * page's own verdict stays the truth. One folded line until opened (D141): it is an extra, so it does not compete with
 * the page's answer.
 */
export function AskAi({ prompt, body, className }: AskAiProps) {
  const titleId = useId();
  const { state, copy } = useCopy();
  return (
    <section aria-labelledby={titleId} data-slot="ask-ai" className={cn('rounded-lg border border-border bg-surface px-4', className)}>
      <Disclosure
        variant="row"
        summary={
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 id={titleId} className="flex items-center gap-2 font-semibold">
              <MessageSquareTextIcon aria-hidden="true" className="size-4 text-muted" />
              {t('askAi.title')}
            </h3>
            <span className="text-sm font-normal text-muted">{t('askAi.hint')}</span>
          </span>
        }
      >
        <p className="text-sm text-muted">{body ?? t('askAi.body')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {PROVIDERS.map(({ provider, label }) => (
            <Button key={provider} variant="outline" asChild>
              <a href={aiPromptUrl(provider, prompt)} target="_blank" rel={NEW_TAB_REL}>
                {t(label)}
                <ExternalLinkIcon aria-hidden="true" />
                <span className="sr-only">{t('askAi.newTab')}</span>
              </a>
            </Button>
          ))}
          <Button
            variant="ghost"
            onClick={() => {
              void copy(prompt);
            }}
          >
            <CopyIcon aria-hidden="true" />
            {t('askAi.copy')}
          </Button>
          <p aria-live="polite" className={cn('text-sm', state === 'failed' ? 'text-danger' : 'text-muted')}>
            {state === 'copied' ? t('askAi.copied') : state === 'failed' ? t('askAi.copyFailed') : ''}
          </p>
        </div>
        <Disclosure summary={t('askAi.show')}>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-subtle p-3 font-mono text-xs whitespace-pre-wrap break-words">{prompt}</pre>
        </Disclosure>
      </Disclosure>
    </section>
  );
}
