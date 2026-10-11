import { formatUtcDate } from '@stakeward/core';
import { useState } from 'react';
import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { ActionBar } from '@/components/product/action-bar';
import { AddressText } from '@/components/product/address-text';
import { ErrorState } from '@/components/product/error-state';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { explorerUrl } from '@/config';
import { useLoad, type Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { fetchChallengeKey } from './challenge-key.ts';
import { CHALLENGE } from './wallet.ts';

/**
 * /challenge, devnet only (DECISIONS.md D132): the public "Try to steal it" wallet. The main key of a locked devnet
 * stake account is shown in full, with what a thief holding it can and cannot do; the live state is on /proof. The key
 * comes from GET /api/challenge, not from the bundle.
 */
/** Proves this devnet-only page is in the devnet build and not in the mainnet one (test/build-output.test.ts). */
export const CHALLENGE_MARKER = 'stakeward-dev-only:challenge';

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
      return <AddressText address={secret.value} variant="full" explorer={false} />;
  }
}

export default function ChallengePage({ load = () => fetchChallengeKey() }: { load?: () => Promise<string> }) {
  const [attempt, setAttempt] = useState(0);
  const secret = useLoad(`challenge#${String(attempt)}`, load);
  const until = formatUtcDate(CHALLENGE.lockUntil) ?? '';
  return (
    <Page width="flow">
      <span hidden data-marker={CHALLENGE_MARKER} />
      <PageHeader
        title={t('challenge.title')}
        lead={t('challenge.intro', { date: until })}
        meta={<p>{t('challenge.devnetOnly')}</p>}
      />

      <Section title={t('challenge.keyTitle')} description={t('challenge.keyHint')}>
        <MainKey
          secret={secret}
          onRetry={() => {
            setAttempt((value) => value + 1);
          }}
        />
        <dl className="flex flex-col gap-3 text-sm">
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
            <dd>{until}</dd>
          </div>
        </dl>
      </Section>

      <Section title={t('challenge.canTitle')}>
        <ul className="list-disc space-y-1 pl-5 text-base text-pretty">
          <li>{t('challenge.can.staker')}</li>
          <li>{t('challenge.can.delegate')}</li>
          <li>{t('challenge.can.split')}</li>
        </ul>
      </Section>

      <Section title={t('challenge.cannotTitle')}>
        <ul className="list-disc space-y-1 pl-5 text-base text-pretty">
          <li>{t('challenge.cannot.withdraw')}</li>
          <li>{t('challenge.cannot.owner')}</li>
          <li>{t('challenge.cannot.lock')}</li>
        </ul>
        <p className="text-base text-pretty text-muted">{t('challenge.why')}</p>
      </Section>

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
