import { getAddressDecoder } from '@solana/kit';
import { formatAlert } from '@stakeward/core';
import { BellIcon } from 'lucide-react';
import { Disclosure } from '@/components/product/disclosure';
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

/**
 * Alerts in Telegram (CLAUDE.md section 8): what one looks like, how to turn them on and off, and, one click away,
 * every change that sends one (DECISIONS.md D109: the answer first, the list of details folded).
 */
export function Alerts({ params }: { params: Readonly<Record<string, string>> }) {
  return (
    <Section id="alerts" title={t('landing.alerts.title')} intro={t('landing.alerts.intro')}>
      <div className="grid items-start gap-4 md:grid-cols-2 md:gap-8">
        <figure className="flex max-w-md flex-col gap-2">
          <figcaption className="text-sm font-medium text-muted">{t('landing.alerts.exampleTitle')}</figcaption>
          <div className="flex flex-col overflow-hidden rounded-lg rounded-tl-sm border border-border bg-surface-raised">
            <p className="px-4 py-3 text-sm">{SAMPLE_ALERT.text}</p>
            {/* The bot's link button, drawn: an example to look at, not a control. */}
            <span className="border-t border-border px-4 py-2 text-center text-sm font-medium text-muted">{SAMPLE_ALERT.buttonLabel}</span>
          </div>
        </figure>
        <div className="flex flex-col gap-4 text-sm md:pt-7">
          <p className="text-pretty">{t('landing.alerts.howTo')}</p>
          <Disclosure summary={t('landing.alerts.eventsTitle')} id="alerts-events">
            <ul className="flex flex-col gap-1.5">
              {EVENTS.map((event) => (
                <li key={event} className="flex items-start gap-2">
                  <BellIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
                  <span>{t(`landing.alerts.events.${event}`, params)}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      </div>
    </Section>
  );
}
