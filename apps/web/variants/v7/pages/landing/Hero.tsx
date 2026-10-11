import { getAddressDecoder } from '@solana/kit';
import { formatAlert, type Cluster } from '@stakeward/core';
import { cn } from 'cn';
import {
  BellOffIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FlaskConicalIcon,
  GlobeIcon,
  ListIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/* Made-up public addresses for the example alert: 32 bytes of 7, 8 and 9 (as on /learn). */
const SAMPLE_STAKE = getAddressDecoder().decode(new Uint8Array(32).fill(7));
const SAMPLE_MAIN = getAddressDecoder().decode(new Uint8Array(32).fill(8));
const SAMPLE_SECOND = getAddressDecoder().decode(new Uint8Array(32).fill(9));

/** The bot's own words for a stake deactivated while its lock holds (core formatAlert). */
const SAMPLE_ALERT = formatAlert(
  { type: 'DEACTIVATED', details: { deactivationEpoch: '0' }, stakeAccount: SAMPLE_STAKE },
  { withdrawer: SAMPLE_MAIN, custodian: SAMPLE_SECOND, lockUntil: 1n, now: 0n },
);

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

/** With reduced motion the whole timeline shows at once and the step control steps aside. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

type Moment = {
  time: string;
  /** What happens, the same in both futures. */
  event: string;
  left: ReactNode;
  right: ReactNode;
};

/** A transaction as both futures see it: the same request, a different answer from the stake program. */
function Slip({ outcome, ok }: { outcome: string; ok: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 font-mono text-xs sm:text-sm">
      <dl className="grid grid-cols-icon gap-x-4 gap-y-1">
        <dt className="text-muted">Action</dt>
        <dd>Withdraw 1,250 SOL</dd>
        <dt className="text-muted">To</dt>
        <dd>the thief&rsquo;s wallet</dd>
        <dt className="text-muted">Signed by</dt>
        <dd>your main key</dd>
      </dl>
      <p
        className={cn(
          'flex items-center gap-2 border-t border-border pt-2 font-sans text-sm font-semibold',
          ok ? 'text-danger' : 'text-success',
        )}
      >
        {ok ? <CheckIcon aria-hidden="true" className="size-4" /> : <ShieldCheckIcon aria-hidden="true" className="size-4" />}
        {outcome}
      </p>
    </div>
  );
}

const MOMENTS: readonly Moment[] = [
  {
    time: '09:14',
    event: 'Your seed phrase leaks',
    left: <p>A fake support chat gets your 24 words. Your stake answers to that one key, and now someone else holds it.</p>,
    right: (
      <p>
        The same 24 words leak. But your stake is locked to a <strong className="font-semibold">second key</strong> from
        another seed phrase, and the thief does not have it.
      </p>
    ),
  },
  {
    time: '09:15',
    event: 'The thief signs a withdraw',
    left: <Slip ok outcome="Confirmed. The SOL is sent." />,
    right: <Slip ok={false} outcome="Rejected by the network: LockupInForce" />,
  },
  {
    time: '09:16',
    event: 'What is left',
    left: (
      <p>
        <span className="block font-display text-2xl text-danger">0 SOL</span>
        A confirmed transfer cannot be reversed. Nobody can bring it back.
      </p>
    ),
    right: (
      <p>
        <span className="block font-display text-2xl text-primary">1,250 SOL</span>
        Still in your stake account. The thief can still unstake it, and does. Moving it out needs your second key.
      </p>
    ),
  },
  {
    time: '09:20',
    event: 'Your phone',
    left: (
      <p className="flex items-start gap-2">
        <BellOffIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted" />
        Silence. You find out the next time you open your wallet.
      </p>
    ),
    right: (
      <figure className="flex flex-col gap-2">
        <figcaption className="text-sm text-muted">Telegram, from the Stakeward bot</figcaption>
        <div className="flex max-w-sm flex-col overflow-hidden rounded-lg rounded-tl-sm border border-border bg-surface shadow-md">
          <p className="px-4 py-3 text-sm text-pretty">{SAMPLE_ALERT.text}</p>
          {/* The bot's link button, drawn: an example to look at, not a control. */}
          <span className="border-t border-border px-4 py-2 text-center text-sm font-medium text-primary">{SAMPLE_ALERT.buttonLabel}</span>
        </div>
      </figure>
    ),
  },
  {
    time: '09:40',
    event: 'You act',
    left: <p>Nothing left to rescue. You change wallets and hope the rest of your crypto was elsewhere.</p>,
    right: (
      <p>
        Your <strong className="font-semibold">main key</strong>, <strong className="font-semibold">second key</strong> and
        a <strong className="font-semibold">new wallet</strong> sign one rescue. From now on the stake answers only to the
        new wallet.
      </p>
    ),
  },
];

const LAST = MOMENTS.length - 1;

/**
 * The top of the landing page, v7 "Two futures": one leaked seed phrase, told twice, side by side. The left column is
 * the night (no lock), the right the day (with Stakeward). A step control moves the clock; with reduced motion every
 * moment shows at once. Then the two ways in: "Check my stake" (the page's one primary button) and "Protect my stake".
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  const reduced = useReducedMotion();
  const [step, setStep] = useState(1);
  const shown = reduced ? LAST : step;
  const current = MOMENTS[shown] ?? MOMENTS[0];

  return (
    <section aria-labelledby="landing-title" className="flex flex-col">
      {/* The split: two backgrounds from the page edges, the content on one centred grid over them. */}
      <div className="relative isolate">
        <div aria-hidden="true" className="absolute inset-y-0 left-0 -z-10 hidden w-1/2 bg-night md:block" />
        <div aria-hidden="true" className="absolute inset-y-0 right-0 -z-10 hidden w-1/2 bg-day md:block" />
        <div aria-hidden="true" className="absolute inset-y-0 left-1/2 -z-10 hidden w-0.5 -translate-x-1/2 bg-clock md:block" />

        <div className="mx-auto w-full max-w-6xl md:px-4">
          {/* Headline across the seam: the left words on night, the right ones on day. */}
          <div className="grid md:grid-cols-futures">
            <div className="scope-night flex flex-col gap-4 px-4 pt-10 pb-8 md:bg-transparent md:pt-16 md:pr-10 md:pl-0">
              <p className="flex items-center gap-2 text-sm font-medium text-muted">
                <ShieldOffIcon aria-hidden="true" className="size-4" />
                Without the lock
              </p>
              <h1 id="landing-title" className="text-3xl text-balance md:text-display">
                Same stolen key.
                <span className="sr-only"> Two different mornings.</span>
              </h1>
              <p className="max-w-md text-base text-pretty text-muted sm:text-lg">
                Your stake answers to one key. Whoever gets it can withdraw everything, in one transaction.
              </p>
            </div>
            <div aria-hidden="true" className="hidden md:block" />
            <div className="scope-day flex flex-col gap-4 px-4 pt-8 pb-10 md:bg-transparent md:pt-16 md:pr-0 md:pl-10">
              <p className="flex items-center gap-2 text-sm font-medium text-primary">
                <ShieldCheckIcon aria-hidden="true" className="size-4" />
                With Stakeward
              </p>
              <p aria-hidden="true" className="font-display text-3xl text-balance md:text-display">
                Two different mornings.
              </p>
              <p className="max-w-md text-base text-pretty text-muted sm:text-lg">{t('landing.lead')}</p>
              <div className="flex flex-col gap-3">
                <div className="flex gap-3 *:flex-1 *:px-3 sm:*:flex-none sm:*:px-6">
                  <Button asChild size="lg">
                    <Link href="/app">{t('landing.checkStake')}</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/protect">{t('landing.protectStake')}</Link>
                  </Button>
                </div>
                <p className="text-sm text-muted">{t('landing.checkStakeHint')}</p>
              </div>
            </div>
          </div>

          {/* The clock: the step control. */}
          <Timeline step={shown} reduced={reduced} onStep={setStep} current={current} />
        </div>
      </div>

      {/* Under the split: the network this site works on, the demo, trust. */}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-8 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {TRUST.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <p data-slot="network" className="flex items-center gap-1.5 text-sm text-muted">
            <GlobeIcon aria-hidden="true" className="size-4" />
            {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
            <span className={devnet ? 'lg:hidden' : undefined}>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
          </p>
          <Button asChild variant="link" className="w-fit">
            <Link href="/demo">
              <PlayIcon aria-hidden="true" />
              {t('landing.demoLink')}
            </Link>
          </Button>
          {devnet ? (
            <Button asChild variant="link" className="w-fit">
              <a href={MAINNET_SITE_URL}>
                <GlobeIcon aria-hidden="true" />
                {t('landing.tryMainnet')}
              </a>
            </Button>
          ) : (
            <Button asChild variant="link" className="w-fit">
              <a href={TESTNET_SITE_URL}>
                <FlaskConicalIcon aria-hidden="true" />
                {t('landing.tryTestnet')}
              </a>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function Timeline({
  step,
  reduced,
  onStep,
  current,
}: {
  step: number;
  reduced: boolean;
  onStep: (step: number) => void;
  current: Moment;
}) {
  return (
    <div className="flex flex-col gap-6 pb-12 md:gap-0 md:pb-16">
      <h2 id="timeline-title" className="sr-only">
        One leaked seed phrase, in both futures
      </h2>
      {reduced ? null : (
        <div className="px-4 md:px-0">
          <div
            role="group"
            aria-label="Timeline"
            className="scope-night mx-auto flex w-full max-w-xl flex-col items-center gap-3 rounded-xl border border-border px-3 py-3 shadow-lg sm:px-4"
          >
            <ol role="list" className="grid w-full grid-cols-5 gap-1">
              {MOMENTS.map((moment, index) => (
                <li key={moment.time}>
                  <button
                    type="button"
                    aria-pressed={index === step}
                    aria-label={`${moment.time} ${moment.event}`}
                    onClick={() => {
                      onStep(index);
                    }}
                    className={cn(
                      'flex w-full flex-col items-center rounded-md py-1.5 font-mono text-sm tabular-nums transition-colors hover:bg-subtle sm:text-base',
                      index === step ? 'bg-clock font-semibold text-night' : index < step ? 'text-clock' : 'text-muted',
                    )}
                  >
                    {moment.time}
                  </button>
                </li>
              ))}
            </ol>
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={step === 0}
                onClick={() => {
                  onStep(step - 1);
                }}
              >
                <ChevronLeftIcon aria-hidden="true" />
                Earlier
              </Button>
              <p aria-live="polite" className="sr-only min-w-0 truncate text-center text-sm text-muted sm:not-sr-only">
                {current.event}
              </p>
              {step < LAST ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onStep(step + 1);
                  }}
                >
                  Next
                  <ChevronRightIcon aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onStep(0);
                  }}
                >
                  <RotateCcwIcon aria-hidden="true" />
                  Replay
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <ol role="list" aria-labelledby="timeline-title" className="flex flex-col gap-8 md:mt-10 md:gap-0">
        {MOMENTS.map((moment, index) =>
          index > step ? (
            <PendingMoment key={moment.time} moment={moment} />
          ) : (
            <MomentRow key={moment.time} moment={moment} fresh={index === step && !reduced} />
          ),
        )}
      </ol>
      {reduced || step === LAST ? null : (
        <div className="flex flex-wrap justify-center gap-3 px-4 pt-2 md:pt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onStep(step + 1);
            }}
          >
            Continue to {MOMENTS[step + 1]?.time}
            <ChevronRightIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onStep(LAST);
            }}
            className="md:bg-surface"
          >
            <ListIcon aria-hidden="true" />
            Show the whole morning
          </Button>
        </div>
      )}
    </div>
  );
}

/** The clock chip on the seam: the moment's time and what happens. */
function ClockChip({ moment, pending = false }: { moment: Moment; pending?: boolean }) {
  return (
    <div
      className={cn(
        'scope-night flex w-fit flex-row items-baseline gap-3 rounded-lg border px-3 py-2 md:w-28 md:flex-col md:items-center md:gap-1 md:text-center',
        pending ? 'border-dashed border-border-strong' : 'border-clock shadow-md',
      )}
    >
      <time className={cn('font-mono text-[1.375rem]/7 font-semibold tabular-nums md:text-[1.75rem]/8', pending ? 'text-muted' : 'text-clock')}>{moment.time}</time>
      <span className="text-sm leading-tight text-foreground md:text-xs">{moment.event}</span>
    </div>
  );
}

function MomentRow({ moment, fresh }: { moment: Moment; fresh: boolean }) {
  return (
    <li className={cn('grid gap-3 px-4 md:grid-cols-futures md:gap-0 md:px-0 md:py-6', fresh && 'animate-moment-in')}>
      <div className="md:col-start-2 md:row-start-1 md:flex md:items-start md:justify-center">
        <ClockChip moment={moment} />
      </div>
      <div className="scope-night rounded-lg border border-border p-4 text-base text-pretty md:col-start-1 md:border-0 md:row-start-1 md:rounded-none md:bg-transparent md:p-0 md:pr-10">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted md:hidden">
          <ShieldOffIcon aria-hidden="true" className="size-3.5" />
          Without the lock
        </p>
        {moment.left}
      </div>
      <div className="scope-day rounded-lg border border-border p-4 text-base text-pretty md:col-start-3 md:row-start-1 md:rounded-none md:border-0 md:bg-transparent md:p-0 md:pl-10">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-primary md:hidden">
          <ShieldCheckIcon aria-hidden="true" className="size-3.5" />
          With Stakeward
        </p>
        {moment.right}
      </div>
    </li>
  );
}

/** A moment the visitor has not reached yet: only its time, quiet, so the clock shows how far the story goes. */
function PendingMoment({ moment }: { moment: Moment }) {
  return (
    <li aria-hidden="true" className="hidden md:grid md:grid-cols-futures md:py-3">
      <div className="md:col-start-2 md:flex md:justify-center">
        <ClockChip moment={moment} pending />
      </div>
    </li>
  );
}
