import { ArrowDownIcon, ArrowRightIcon, BellRingIcon, ListChecksIcon, LockIcon, SignatureIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { t, type MessageKey } from '@/i18n';
import { ArrowMark, PlusMark, RoleChip } from './chips.tsx';

type StepId = 'choose' | 'lock' | 'alerts';

/**
 * The three steps of CLAUDE.md section 10 step 8: choose the stake and a second key (F1.2), both keys sign the lock
 * (F1.4), alerts and Rescue (F2, F4).
 */
const STEPS: readonly { id: StepId; icon: LucideIcon; title: MessageKey; body: MessageKey }[] = [
  { id: 'choose', icon: ListChecksIcon, title: 'landing.how.choose.title', body: 'landing.how.choose.body' },
  { id: 'lock', icon: SignatureIcon, title: 'landing.how.lock.title', body: 'landing.how.lock.body' },
  { id: 'alerts', icon: BellRingIcon, title: 'landing.how.alerts.title', body: 'landing.how.alerts.body' },
];

/** "How it works": three numbered cards, joined by arrows (down on a phone, across from md). */
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="how-it-works-title" className="text-2xl font-semibold">
          {t('landing.how.title')}
        </h2>
        <p className="max-w-prose text-muted">{t('landing.how.intro')}</p>
      </div>
      <ol className="grid gap-8 md:grid-cols-3">
        {STEPS.map(({ id, icon: Icon, title, body }, index) => (
          <li
            key={id}
            data-step={id}
            className="relative flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <span className="text-sm font-medium text-primary">{t('landing.how.stepLabel', { number: index + 1 })}</span>
            </div>
            <h3 className="text-lg font-semibold">{t(title)}</h3>
            <p className="text-sm text-muted">{t(body)}</p>
            <StepScheme step={id} />
            {index < STEPS.length - 1 ? <StepArrow /> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The step as a scheme of role chips: who signs and what comes of it. It repeats the step's text, so screen readers
 * skip it.
 */
function StepScheme({ step }: { step: StepId }) {
  return (
    <div aria-hidden="true" data-slot="step-scheme" className="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-2 pt-2">
      {step === 'choose' ? (
        <>
          <RoleChip role="main" />
          <RoleChip role="second" />
        </>
      ) : step === 'lock' ? (
        <>
          <Group>
            <RoleChip role="main" />
            <PlusMark />
            <RoleChip role="second" />
          </Group>
          <Group>
            <ArrowMark />
            <Badge tone="success">
              <LockIcon aria-hidden="true" />
              {t('landing.how.lockChip')}
            </Badge>
          </Group>
        </>
      ) : (
        <>
          <Badge tone="info">
            <BellRingIcon aria-hidden="true" />
            {t('landing.how.alertChip')}
          </Badge>
          <Group>
            <ArrowMark />
            <RoleChip role="main" />
            <PlusMark />
            <RoleChip role="second" />
          </Group>
          <Group>
            <ArrowMark />
            <RoleChip role="new" />
          </Group>
        </>
      )}
    </div>
  );
}

/** Chips that move to the next line together; they break apart only when the card is narrower than all of them. */
function Group({ children }: { children: ReactNode }) {
  return <span className="flex flex-wrap items-center gap-1.5">{children}</span>;
}

/** The arrow to the next step, centred in the gap-8 between two cards. */
function StepArrow() {
  return (
    <span
      aria-hidden="true"
      className="absolute -bottom-6 left-1/2 flex size-4 -translate-x-1/2 text-muted md:top-1/2 md:-right-6 md:bottom-auto md:left-auto md:translate-x-0 md:-translate-y-1/2"
    >
      <ArrowDownIcon className="size-4 md:hidden" />
      <ArrowRightIcon className="hidden size-4 md:block" />
    </span>
  );
}
