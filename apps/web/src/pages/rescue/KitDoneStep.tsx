import type { Address } from '@solana/kit';
import { CircleAlertIcon, CircleCheckIcon, SendIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { JobView } from '@/signing/machine';
import { rescueRefusalText } from './plan.ts';

type KitDoneStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  outcomes: readonly JobView[];
  newWallet: Address;
  /** Each stored kit's one-time Telegram link (null without a bot). */
  telegram: ReadonlyMap<Address, string | null>;
  onRetry: () => void;
};

/** Why one kit was not saved, in plain words; null when it was. */
function failureText(job: JobView): string | null {
  const { state } = job;
  switch (state.kind) {
    case 'done':
    case 'already-done':
      return null;
    case 'refused':
      return rescueRefusalText(state.reason);
    case 'failed':
    case 'sim-failed':
      return errorMessage(state.error);
    default:
      return t('rescueKit.done.notSaved');
  }
}

/**
 * The end of a kit run (D118): per account whether its kit is kept, with the page that sends it, and what happens
 * next. The stake has not moved: it moves only when the kit is sent.
 */
export function KitDoneStep({ headingRef, outcomes, newWallet, telegram, onRetry }: KitDoneStepProps) {
  const headingId = useId();
  const saved = outcomes.filter((job) => failureText(job) === null);
  const failed = outcomes.length - saved.length;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {saved.length === 0 ? t('rescueKit.done.noneHeading') : t('rescueKit.done.heading')}
        </h2>
        <p className="max-w-prose text-pretty">{t('rescueKit.done.lead')}</p>
        <div className="flex flex-col gap-1 rounded-lg bg-subtle px-4 py-3">
          <p className="text-sm font-medium">{t('rescueKit.done.newWallet')}</p>
          <AddressText address={newWallet} variant="full" explorer />
        </div>
      </div>
      <ul role="list" className="flex flex-col gap-3">
        {outcomes.map((job) => {
          const reason = failureText(job);
          const Icon = reason === null ? CircleCheckIcon : CircleAlertIcon;
          return (
            <li key={job.id} data-kit={reason === null ? 'saved' : 'failed'} className="flex items-start gap-3">
              <Icon aria-hidden="true" className={reason === null ? 'mt-0.5 size-5 shrink-0 text-success' : 'mt-0.5 size-5 shrink-0 text-danger'} />
              <div className="flex min-w-0 flex-col gap-1">
                <AddressText address={job.id} explorer />
                {reason === null ? (
                  <TelegramLink url={telegram.get(job.id as Address) ?? null} />
                ) : (
                  <p className="text-sm">{reason}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="max-w-prose text-sm text-muted">{t('rescueKit.done.keepNewWallet')}</p>
      <div className="flex flex-wrap gap-2">
        {failed > 0 ? <Button onClick={onRetry}>{t('common.tryAgain')}</Button> : null}
        <Button asChild variant={failed > 0 ? 'outline' : 'primary'}>
          <Link href="/app">{t('rescueKit.done.toAccounts')}</Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * The kit's one-time link to the bot: the chat that opens it gets the alerts with a Rescue now button that sends this
 * kit. Shown once, here; without it the kit is still sent by itself when the staker changes.
 */
function TelegramLink({ url }: { url: string | null }) {
  if (url === null) return <p className="text-sm text-muted">{t('rescueKit.done.noTelegram')}</p>;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button asChild size="sm">
        <a href={url} target="_blank" rel="noreferrer">
          <SendIcon aria-hidden="true" />
          {t('rescueKit.done.telegram')}
        </a>
      </Button>
      <p className="text-sm text-muted">{t('rescueKit.done.telegramOnce')}</p>
    </div>
  );
}
