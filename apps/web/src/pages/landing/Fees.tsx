import { formatSol, LAMPORTS_PER_SIGNATURE, networkFeeFor } from '@stakeward/core';
import type { ReactNode } from 'react';
import { SolAmount, SolAmountSkeleton } from '@/components/product/sol-amount';
import type { Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { Section } from './Section.tsx';

function FeeRow({ label, amount, payer }: { label: string; amount: ReactNode; payer: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="font-medium sm:shrink-0">{label}</dt>
      <dd className="flex flex-col gap-1 sm:items-end sm:text-right">
        <span className="font-medium">{amount}</span>
        <span className="text-sm text-muted">{payer}</span>
      </dd>
    </div>
  );
}

/** The deposit as read from the network; neutral words if that read failed (spec L9: no error box, no retry). */
function Deposit({ deposit }: { deposit: Load<bigint> }) {
  switch (deposit.status) {
    case 'ready':
      return <SolAmount lamports={deposit.value} />;
    case 'error':
      return t('landing.fees.depositUnknown');
    default:
      return (
        <>
          <SolAmountSkeleton />
          <span className="sr-only">{t('common.loading')}</span>
        </>
      );
  }
}

/**
 * What it costs (CLAUDE.md section 2, rule 4): network fees from the same formula the signing screens use
 * (core networkFeeFor: 5000 lamports per signature plus the fixed priority fee) and the link-signing deposit read from
 * the network (D22). Stakeward itself charges nothing.
 */
export function Fees({ deposit }: { deposit: Load<bigint> }) {
  return (
    <Section id="fees" title={t('landing.fees.title')}>
      <div className="flex max-w-prose flex-col gap-2">
        <p>{t('landing.fees.intro')}</p>
        <p>{t('landing.fees.perSignature', { amount: formatSol(LAMPORTS_PER_SIGNATURE) })}</p>
      </div>
      <dl className="flex max-w-3xl flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        <FeeRow label={t('landing.fees.protect')} amount={<SolAmount lamports={networkFeeFor(2)} />} payer={t('landing.fees.protectPayer')} />
        <FeeRow
          label={t('landing.fees.extend')}
          amount={<SolAmount lamports={networkFeeFor(1)} />}
          payer={t('landing.fees.extendPayer', { amount: formatSol(networkFeeFor(2)) })}
        />
        <FeeRow
          label={t('landing.fees.withdraw')}
          amount={<SolAmount lamports={networkFeeFor(2)} />}
          payer={t('landing.fees.withdrawPayer', { amount: formatSol(networkFeeFor(1)) })}
        />
        <FeeRow label={t('landing.fees.rescue')} amount={<SolAmount lamports={networkFeeFor(3)} />} payer={t('landing.fees.rescuePayer')} />
        <FeeRow label={t('landing.fees.deposit')} amount={<Deposit deposit={deposit} />} payer={t('landing.fees.depositPayer')} />
      </dl>
    </Section>
  );
}
