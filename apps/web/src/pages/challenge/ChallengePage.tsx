import { cn } from 'cn';
import { CheckIcon, InfoIcon, KeyRoundIcon, LockKeyholeIcon, ShieldCheckIcon, TerminalIcon, XIcon, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { ActionBar } from '@/components/product/action-bar';
import { AddressText } from '@/components/product/address-text';
import { CommandBlock } from '@/components/product/command-block';
import { ErrorState } from '@/components/product/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { explorerUrl } from '@/config';
import { useLoad, type Load } from '@/hooks/use-load';
import { formatDate, t, type MessageKey } from '@/i18n';
import { fetchChallengeKey } from './challenge-key.ts';
import { challengeCommands, type ChallengeCommandId } from './commands.ts';
import { CHALLENGE } from './wallet.ts';

/**
 * /challenge, devnet only (DECISIONS.md D133): the public "Try to steal it" wallet. The main key of a locked devnet
 * stake account is shown in full, with what a thief holding it can and cannot do, and Solana CLI commands to try each
 * forbidden step; the live state is on /proof. The key comes from GET /api/challenge, not from the bundle.
 */
/** Proves this devnet-only page is in the devnet build and not in the mainnet one (test/build-output.test.ts). */
export const CHALLENGE_MARKER = 'stakeward-dev-only:challenge';

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

function MainKey({ secret, onRetry }: { secret: Load<string>; onRetry: () => void }) {
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
        <div className="rounded-md border border-warning-border bg-warning-soft p-3">
          <AddressText address={secret.value} variant="full" explorer={false} />
        </div>
      );
  }
}

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
  const commands = challengeCommands(secret);
  return (
    <ol className="flex flex-col gap-6">
      <Step n={1} title={t('challenge.try.setupTitle')}>
        <p className="text-sm text-pretty text-muted">{t('challenge.try.setupHint')}</p>
        <CommandBlock argv={commands.wallet} label={t('challenge.try.walletLabel')} />
        <CommandBlock argv={commands.airdrop} label={t('challenge.try.airdropLabel')} />
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
      <span hidden data-marker={CHALLENGE_MARKER} />
      <PageHeader
        title={t('challenge.title')}
        lead={t('challenge.intro', { date: until })}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">
              <LockKeyholeIcon aria-hidden="true" />
              {t('challenge.lockedBadge', { date: until })}
            </Badge>
            <Badge tone="outline">{t('challenge.devnetBadge')}</Badge>
          </div>
        }
      />

      <Alert tone="info">
        <InfoIcon aria-hidden="true" />
        <AlertDescription>{t('challenge.devnetOnly')}</AlertDescription>
      </Alert>

      <Panel icon={KeyRoundIcon} tone="warning" title={t('challenge.keyTitle')}>
        <p className="text-base text-pretty text-muted">{t('challenge.keyHint')}</p>
        <MainKey secret={secret} onRetry={retry} />
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
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
        <p className="text-base text-pretty text-muted">{t('challenge.try.intro')}</p>
        {secret.status === 'ready' ? (
          <Commands secret={secret.value} />
        ) : (
          <p className="text-sm text-muted">{t('challenge.try.waitingForKey')}</p>
        )}
      </Panel>

      <Alert tone="success">
        <ShieldCheckIcon aria-hidden="true" />
        <AlertDescription className="text-foreground">{t('challenge.why')}</AlertDescription>
      </Alert>

      <ActionBar
        primary={
          <Button asChild>
            <Link href={`/proof/${CHALLENGE.mainKey}`}>{t('challenge.proof')}</Link>
          </Button>
        }
        secondary={
          <>
            <Button asChild variant="outline">
              <Link href={`/try-steal/${CHALLENGE.stakeAccount}`}>{t('challenge.simulate')}</Link>
            </Button>
            <Button asChild variant="ghost">
              <a href={explorerUrl('address', CHALLENGE.stakeAccount, 'devnet')} target="_blank" rel="noreferrer">
                {t('challenge.explorer')}
              </a>
            </Button>
          </>
        }
      />
    </Page>
  );
}
