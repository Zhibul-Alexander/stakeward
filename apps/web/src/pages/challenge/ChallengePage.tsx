import { buildProof } from '@stakeward/core';
import { cn } from 'cn';
import {
  CheckIcon,
  CopyIcon,
  InfoIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  RadioIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  TerminalIcon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { ActionBar } from '@/components/product/action-bar';
import { AddressText } from '@/components/product/address-text';
import { CommandBlock } from '@/components/product/command-block';
import { Disclosure } from '@/components/product/disclosure';
import { ErrorState } from '@/components/product/error-state';
import { QrCode } from '@/components/product/qr-code';
import { SolAmount } from '@/components/product/sol-amount';
import { useCopy } from '@/components/product/use-copy';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { CLUSTER, explorerUrl, IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { useLoad, type Load } from '@/hooks/use-load';
import { formatDate, t, type MessageKey } from '@/i18n';
import { usePorts } from '@/ports';
import { useStakeAccounts } from '@/pages/app/hooks';
import { fetchChallengeKey } from './challenge-key.ts';
import { challengeCommands, type ChallengeCommandId } from './commands.ts';
import { CHALLENGE } from './wallet.ts';

/**
 * /challenge (DECISIONS.md D133, D154): the public "Try to steal it" wallet of this build's cluster. The main key of a
 * locked stake account is shown in full, with a button to copy it, how to import it into a wallet, what a thief
 * holding it can and cannot do, and Solana CLI commands to try each forbidden step. The hero reads the stake from the
 * network on every visit: what its stake accounts hold and how much of the starting SOL left them. The key comes from
 * GET /api/challenge, not from the bundle; the site never signs with it.
 */

/** This page on the site of this build's cluster: what the QR code opens on a phone. */
const PAGE_URL = `${IS_DEVNET ? TESTNET_SITE_URL : MAINNET_SITE_URL}/challenge`;

/** A framed block of the page: an icon in a tinted circle, a heading, then its content. */
function Panel({
  icon: Icon,
  tone,
  title,
  children,
  className,
}: {
  icon: LucideIcon;
  tone: 'success' | 'warning' | 'neutral';
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const circle = {
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    neutral: 'bg-subtle text-muted',
  }[tone];
  return (
    <section className={cn('flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-6', className)}>
      <h2 className="flex items-center gap-3 text-lg font-semibold">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', circle)}>
          <Icon aria-hidden="true" className="size-5" />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One line of the can / cannot lists: the icon carries the verdict together with the list's heading. */
function Verdict({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  const Icon = allowed ? CheckIcon : XIcon;
  return (
    <li className="flex items-start gap-2 text-base text-pretty">
      <Icon aria-hidden="true" className={cn('mt-1 size-4 shrink-0', allowed ? 'text-warning' : 'text-success')} />
      <span>{children}</span>
    </li>
  );
}

/** One figure of the hero: a label over a large value. */
function Figure({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-0.5 border-t border-on-inverse/30 pt-2 sm:gap-1 sm:pt-3', className)}>
      <dt className="text-sm opacity-80">{label}</dt>
      <dd className="font-display text-2xl tabular-nums sm:text-3xl">{children}</dd>
    </div>
  );
}

/**
 * The page's one bright zone, on the inverse band of the landing's closing call (FinalCta): the network, the claim, the
 * live figures and the first thing to do, which needs no wallet and no key (the simulation on /try-steal). Taken is the
 * starting SOL minus what the main key's stake accounts hold now: a Split keeps the SOL under the same lock, so all of
 * them count. The main key's ordinary balance is not counted (the lock does not cover it), and the line under the
 * figures says so.
 */
function Hero({ until }: { until: string }) {
  const { chain } = usePorts();
  const [attempt, setAttempt] = useState(0);
  const state = useStakeAccounts(chain, CHALLENGE.mainKey, attempt, 'main');
  const held = useMemo(
    () => (state.status === 'ready' ? buildProof(CHALLENGE.mainKey, state.data.accounts, state.data.clock).totals.lamports : null),
    [state],
  );
  const taken = held === null ? null : held >= CHALLENGE.startLamports ? 0n : CHALLENGE.startLamports - held;
  const live = (value: bigint | null) => (value === null ? <Spinner aria-hidden="true" className="size-6" /> : <SolAmount lamports={value} />);
  return (
    <section
      aria-labelledby="challenge-title"
      data-slot="challenge-hero"
      className="flex flex-col gap-6 rounded-lg border-t-4 border-primary bg-inverse bg-blueprint-inverse p-5 text-on-inverse sm:p-8"
    >
      <div className="flex flex-col gap-3">
        <p className="inline-flex w-fit items-center gap-1.5 rounded-sm border border-on-inverse/40 px-2 py-0.5 font-display text-xs font-medium">
          <RadioIcon aria-hidden="true" className="size-3.5" />
          {t(IS_DEVNET ? 'challenge.network.devnet' : 'challenge.network.mainnet')}
        </p>
        <h1 id="challenge-title" className="font-display text-3xl text-balance sm:text-4xl">
          {t('challenge.title')}
        </h1>
        <p className="max-w-prose text-base text-pretty opacity-90 sm:text-lg">{t('challenge.intro')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <dl aria-label={t('challenge.hero.label')} aria-busy={state.status === 'loading'} className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {/* After a failed read the two live figures give way to the line below, which says so and offers a retry. */}
          {state.status === 'error' ? null : (
            <>
              <Figure label={t('challenge.hero.balance')}>{live(held)}</Figure>
              <Figure label={t('challenge.hero.taken')}>{live(taken)}</Figure>
            </>
          )}
          {/* Its own row from 640 px: a full SOL amount fills half the band, so three columns would collide. */}
          <Figure label={t('challenge.hero.lockedUntil')} className="sm:col-span-2">
            <span className="inline-flex items-center gap-2">
              <LockKeyholeIcon aria-hidden="true" className="size-6 shrink-0" />
              {until}
            </span>
          </Figure>
        </dl>
        {state.status === 'loading' ? (
          <p role="status" className="text-sm opacity-80">
            {t('challenge.hero.loading')}
          </p>
        ) : state.status === 'error' ? (
          <p role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {t('challenge.hero.error')}
            <Button
              variant="outline"
              size="sm"
              className="border-on-inverse bg-transparent text-on-inverse hover:bg-on-inverse hover:text-inverse"
              onClick={() => {
                setAttempt((value) => value + 1);
              }}
            >
              {t('challenge.hero.retry')}
            </Button>
          </p>
        ) : null}
      </div>

      {/* Under the button, so it stands in a phone's first screen: the simulation's terms, then what Taken counts. */}
      <div className="flex flex-col gap-2">
        <Button asChild size="lg" className="w-full sm:w-fit">
          <Link href={`/try-steal/${CHALLENGE.stakeAccount}`}>{t('challenge.hero.simulate')}</Link>
        </Button>
        <p className="text-sm text-pretty opacity-80">{t('challenge.hero.simulateHint')}</p>
        <p className="text-sm text-pretty opacity-80">{t('challenge.hero.scope')}</p>
      </div>
    </section>
  );
}

/** The key in full with a large Copy key button: a wallet app imports it pasted, so copying is the main way. */
function MainKey({ secret, onRetry }: { secret: Load<string>; onRetry: () => void }) {
  const { state, copy } = useCopy();
  switch (secret.status) {
    case 'idle':
    case 'loading':
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Spinner aria-hidden="true" className="text-muted" />
          {t('challenge.keyLoading')}
        </p>
      );
    case 'error':
      return (
        <ErrorState
          title={t('challenge.keyErrorTitle')}
          message={t('challenge.keyErrorBody')}
          detail={secret.error.detail}
          onRetry={onRetry}
        />
      );
    case 'ready':
      return (
        <div className="flex flex-col gap-3">
          <p data-slot="challenge-key" className="rounded-md border border-warning-border bg-warning-soft p-3 font-mono text-sm break-all select-all">
            {secret.value}
          </p>
          <div className="flex flex-col gap-1">
            <Button
              size="lg"
              variant={state === 'copied' ? 'outline' : 'primary'}
              className="w-full sm:w-fit"
              onClick={() => {
                void copy(secret.value);
              }}
            >
              {state === 'copied' ? <CheckIcon aria-hidden="true" className="animate-pop-in" /> : <CopyIcon aria-hidden="true" />}
              {state === 'copied' ? t('challenge.copied') : t('challenge.copyKey')}
            </Button>
            <p role="status" className={cn('text-sm text-danger', state !== 'failed' && 'sr-only')}>
              {state === 'failed' ? t('challenge.copyFailed') : state === 'copied' ? t('challenge.copied') : ''}
            </p>
          </div>
        </div>
      );
  }
}

/** `text` with `flag` set as code that never breaks at its hyphens (every catalog keeps the flag, catalogs.test.ts). */
function WithFlag({ text, flag }: { text: string; flag: string }) {
  const [before, ...rest] = text.split(flag);
  if (rest.length === 0) return text;
  return (
    <>
      {before}
      <code className="font-mono whitespace-nowrap">{flag}</code>
      {rest.join(flag)}
    </>
  );
}

const IMPORT_STEPS: readonly MessageKey[] = [
  'challenge.import.copy',
  'challenge.import.open',
  ...(IS_DEVNET ? (['challenge.import.devnet'] as const) : []),
  'challenge.import.paste',
];

/** An attempt at a step the lock forbids: what it tries, its command, and the answer to expect. */
const ATTEMPTS: readonly { id: ChallengeCommandId; title: MessageKey; expect: MessageKey }[] = [
  { id: 'withdraw', title: 'challenge.try.withdraw', expect: 'challenge.try.withdrawExpect' },
  { id: 'owner', title: 'challenge.try.owner', expect: 'challenge.try.ownerExpect' },
  { id: 'unlock', title: 'challenge.try.unlock', expect: 'challenge.try.unlockExpect' },
];

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function Commands({ secret }: { secret: string }) {
  const commands = challengeCommands(secret, CLUSTER);
  return (
    <ol className="flex flex-col gap-6">
      <Step n={1} title={t(IS_DEVNET ? 'challenge.try.setupTitle.devnet' : 'challenge.try.setupTitle.mainnet')}>
        <p className="text-sm text-pretty text-muted">{t(IS_DEVNET ? 'challenge.try.setupHint.devnet' : 'challenge.try.setupHint.mainnet')}</p>
        <CommandBlock argv={commands.wallet} label={t('challenge.try.walletLabel')} />
        <CommandBlock argv={commands.fund} label={t(IS_DEVNET ? 'challenge.try.fundLabel.devnet' : 'challenge.try.fundLabel.mainnet')} />
      </Step>
      <Step n={2} title={t('challenge.try.keyFileTitle')}>
        <CommandBlock argv={commands.keyFile} label={t('challenge.try.keyFileTitle')} />
      </Step>
      {ATTEMPTS.map((attempt, index) => (
        <Step key={attempt.id} n={index + 3} title={t(attempt.title)}>
          <CommandBlock argv={commands[attempt.id]} label={t(attempt.title)} />
          <p className="flex items-start gap-2 text-sm font-medium text-success">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t(attempt.expect)}
          </p>
        </Step>
      ))}
    </ol>
  );
}

export default function ChallengePage({ load = () => fetchChallengeKey() }: { load?: () => Promise<string> }) {
  const [attempt, setAttempt] = useState(0);
  const secret = useLoad(`challenge#${String(attempt)}`, load);
  const until = formatDate(CHALLENGE.lockUntil) ?? '';
  const retry = () => {
    setAttempt((value) => value + 1);
  };
  return (
    <Page width="flow">
      <Hero until={until} />

      {IS_DEVNET ? (
        <Alert tone="info">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>{t('challenge.devnetOnly')}</AlertDescription>
        </Alert>
      ) : null}

      <Panel icon={KeyRoundIcon} tone="warning" title={t('challenge.keyTitle')}>
        <p className="text-base text-pretty text-muted">{t('challenge.keyHint')}</p>
        <MainKey secret={secret} onRetry={retry} />
        <p data-slot="never-send" className="flex items-start gap-2 text-sm font-medium text-pretty text-danger">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('challenge.neverSend')}
        </p>
        {/* Why no one has to fund the key to try: a wallet would ask for it, the simulation and the CLI do not (D154). */}
        <p data-slot="fee-hint" className="-mt-2 pl-6 text-sm text-pretty text-muted">
          {t('challenge.feeHint')}
        </p>
        <div data-slot="fee-payer" className="flex flex-col gap-1 rounded-md bg-subtle p-3">
          <h3 className="text-sm font-semibold">{t('challenge.feePayer.title')}</h3>
          <p className="text-sm text-pretty">
            <WithFlag text={t('challenge.feePayer.body')} flag="--fee-payer" />
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">{t('challenge.import.title')}</h3>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-base text-pretty">
            {IMPORT_STEPS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </div>
        <dl className="grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-muted">{t('challenge.mainKey')}</dt>
            <dd>
              <AddressText address={CHALLENGE.mainKey} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted">{t('challenge.stakeAccount')}</dt>
            <dd>
              <AddressText address={CHALLENGE.stakeAccount} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted">{t('challenge.secondKey')}</dt>
            <dd>
              <AddressText address={CHALLENGE.secondKey} />
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-muted">{t('challenge.lockedUntil')}</dt>
            <dd className="font-medium">{until}</dd>
          </div>
        </dl>
      </Panel>

      {/* A desktop visitor carries the page to a phone, where the wallet app is; on a phone it is the page itself. */}
      <section data-slot="challenge-qr" className="hidden items-center gap-6 rounded-lg border border-border bg-surface p-6 sm:flex">
        <QrCode value={PAGE_URL} label={t('challenge.qr.label')} className="size-36 shrink-0" />
        <div className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <SmartphoneIcon aria-hidden="true" className="size-5 text-muted" />
            {t('challenge.qr.title')}
          </h2>
          <p className="text-base text-pretty text-muted">{t('challenge.qr.hint')}</p>
          <p className="font-mono text-sm break-all">{PAGE_URL}</p>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel icon={CheckIcon} tone="warning" title={t('challenge.canTitle')}>
          <ul className="flex flex-col gap-2">
            <Verdict allowed>{t('challenge.can.staker')}</Verdict>
            <Verdict allowed>{t('challenge.can.delegate')}</Verdict>
            <Verdict allowed>{t('challenge.can.split')}</Verdict>
          </ul>
        </Panel>
        <Panel icon={ShieldCheckIcon} tone="success" title={t('challenge.cannotTitle')} className="border-success-border">
          <ul className="flex flex-col gap-2">
            <Verdict allowed={false}>{t('challenge.cannot.withdraw')}</Verdict>
            <Verdict allowed={false}>{t('challenge.cannot.owner')}</Verdict>
            <Verdict allowed={false}>{t('challenge.cannot.lock')}</Verdict>
          </ul>
        </Panel>
      </div>

      <Panel icon={TerminalIcon} tone="neutral" title={t('challenge.try.title')}>
        <p className="text-base text-pretty text-muted">{t(IS_DEVNET ? 'challenge.try.intro.devnet' : 'challenge.try.intro.mainnet')}</p>
        <Disclosure summary={t('challenge.try.show')}>
          {secret.status === 'ready' ? (
            <div className="pt-2">
              <Commands secret={secret.value} />
            </div>
          ) : (
            <p className="text-sm text-muted">{t('challenge.try.waitingForKey')}</p>
          )}
        </Disclosure>
      </Panel>

      <Alert tone="success">
        <ShieldCheckIcon aria-hidden="true" />
        <AlertDescription className="text-foreground">{t('challenge.why')}</AlertDescription>
      </Alert>

      <ActionBar
        primary={
          <Button asChild variant="outline">
            <Link href={`/proof/${CHALLENGE.mainKey}`}>{t('challenge.proof')}</Link>
          </Button>
        }
        secondary={
          <Button asChild variant="ghost">
            <a href={explorerUrl('address', CHALLENGE.stakeAccount)} target="_blank" rel="noreferrer">
              {t('challenge.explorer')}
            </a>
          </Button>
        }
      />
    </Page>
  );
}
