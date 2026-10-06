import { getAddressDecoder } from '@solana/kit';
import { formatAlert } from '@stakeward/core';
import { cn } from 'cn';
import { buttonVariants } from '@/components/ui/button';
import { t, type Messages } from '@/i18n';
import { Section } from './Section.tsx';

type AlertEvent = keyof Messages['landing']['alerts']['events'];

const EVENTS: readonly AlertEvent[] = ['deactivated', 'delegation', 'manager', 'owner', 'lock', 'balance', 'closed', 'reminders'];

/** Made-up public addresses for the example: 32 bytes of 7 and of 8. */
const SAMPLE_STAKE = getAddressDecoder().decode(new Uint8Array(32).fill(7));
const SAMPLE_MAIN = getAddressDecoder().decode(new Uint8Array(32).fill(8));
const SAMPLE_SECOND = getAddressDecoder().decode(new Uint8Array(32).fill(9));

/**
 * The example quotes the bot word for word: core formatAlert writes the alert text (the one place where landing copy
 * is not in en.json, DECISIONS.md D79), for a stake deactivated while its lock holds.
 */
const SAMPLE_ALERT = formatAlert(
  { type: 'DEACTIVATED', details: { deactivationEpoch: '0' }, stakeAccount: SAMPLE_STAKE },
  { withdrawer: SAMPLE_MAIN, custodian: SAMPLE_SECOND, lockUntil: 1n, now: 0n },
);

/** Alerts in Telegram (CLAUDE.md section 8): what triggers one, what one looks like, and what they can and cannot do. */
export function Alerts({ params }: { params: Readonly<Record<string, string>> }) {
  return (
    <Section id="alerts" title={t('landing.alerts.title')}>
      <div className="flex max-w-prose flex-col gap-2">
        <p>{t('landing.alerts.intro')}</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {EVENTS.map((event) => (
            <li key={event}>{t(`landing.alerts.events.${event}`, params)}</li>
          ))}
        </ul>
      </div>
      <figure className="flex max-w-md flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
        <figcaption className="text-sm font-medium text-muted">{t('landing.alerts.exampleTitle')}</figcaption>
        <p className="text-sm">{SAMPLE_ALERT.text}</p>
        {/* The bot's link button, drawn: an example to look at, not a control. */}
        <span className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-start')}>{SAMPLE_ALERT.buttonLabel}</span>
      </figure>
      <div className="flex max-w-prose flex-col gap-2">
        <p>{t('landing.alerts.turnOn')}</p>
        <p>{t('landing.alerts.anyWallet')}</p>
        <p>{t('landing.alerts.safe')}</p>
        <p className="text-sm text-muted">{t('landing.alerts.noGuarantee')}</p>
      </div>
    </Section>
  );
}
