import { formatSol, LAMPORTS_PER_SIGNATURE, networkFeeFor } from '@stakeward/core';
import type { ReactNode } from 'react';
import { formatUsd } from '@/api/sol-price';
import { SolAmount, SolAmountSkeleton } from '@/components/product/sol-amount';
import type { Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { Section } from './Section.tsx';

/**
 * One line per cost. Below 640 px: its name and amount on one line (the amount right, tabular), who pays it under
 * them. From 640 px who pays stands between the two, so the table keeps one line per cost on a wide screen.
 */
function FeeRow({ label, amount, payer }: { label: string; amount: ReactNode; payer: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 px-4 py-2 sm:flex-nowrap sm:py-2.5">
      <dt className="min-w-0 flex-1 text-sm font-medium sm:w-52 sm:flex-none">{label}</dt>
      <dd className="text-sm font-medium tabular-nums sm:order-last">{amount}</dd>
      <dd className="w-full text-sm text-pretty text-muted sm:w-auto sm:min-w-0 sm:flex-1">{payer}</dd>
    </div>
  );
}

/**
 * An amount in SOL and, under it, roughly in dollars once the rate is read (D132). SOL stays the number that counts:
 * the dollar line is muted, and absent while the rate loads or when it cannot be read.
 */
function Amount({ lamports, solUsd }: { lamports: bigint; solUsd: Load<number> }) {
  if (solUsd.status !== 'ready') return <SolAmount lamports={lamports} />;
  return (
    <span className="flex flex-col items-end">
      <SolAmount lamports={lamports} />
      <span data-slot="usd-amount" className="text-xs font-normal whitespace-nowrap text-muted">
        {t('landing.fees.usd', { amount: formatUsd(lamports, solUsd.value) })}
      </span>
    </span>
  );
}

/** The deposit as read from the network; neutral words if that read failed (spec L9: no error box, no retry). */
function Deposit({ deposit, solUsd }: { deposit: Load<bigint>; solUsd: Load<number> }) {
  switch (deposit.status) {
    case 'ready':
      return <Amount lamports={deposit.value} solUsd={solUsd} />;
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
 * What it costs (CLAUDE.md section 2, rule 4): free, the network fee per signature in the intro, then the fee for each
 * action and who pays it, all in view (spec [landing] Must stay: the amounts and who pays are what a visitor decides
 * on; CLAUDE.md section 5: a stolen main key never pays, the new wallet pays for a rescue). The amounts come from the
 * same formula the signing screens use (core networkFeeFor: 5000 lamports per signature plus the fixed priority fee),
 * the link-signing deposit is read from the network (D22). Every signing screen shows its fee again before it signs.
 * With the SOL/USD rate read (`solUsd`, D132), each amount also reads roughly in dollars, and a line under the table
 * says at which rate.
 */
export function Fees({ deposit, solUsd = { status: 'idle' } }: { deposit: Load<bigint>; solUsd?: Load<number> }) {
  // The fee per signature never breaks between its number and "SOL".
  const perSignature = formatSol(LAMPORTS_PER_SIGNATURE).replaceAll(' ', '\u00a0');
  return (
    <Section id="fees" title={t('landing.fees.title')} intro={t('landing.fees.intro', { amount: perSignature })}>
      <dl className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        <FeeRow label={t('landing.fees.protect')} amount={<Amount lamports={networkFeeFor(2)} solUsd={solUsd} />} payer={t('landing.fees.protectPayer')} />
        <FeeRow
          label={t('landing.fees.extend')}
          amount={<Amount lamports={networkFeeFor(1)} solUsd={solUsd} />}
          payer={t('landing.fees.extendPayer', { amount: formatSol(networkFeeFor(2)) })}
        />
        <FeeRow label={t('landing.fees.changeKey')} amount={<Amount lamports={networkFeeFor(2)} solUsd={solUsd} />} payer={t('landing.fees.changeKeyPayer')} />
        <FeeRow
          label={t('landing.fees.withdraw')}
          amount={<Amount lamports={networkFeeFor(2)} solUsd={solUsd} />}
          payer={t('landing.fees.withdrawPayer', { amount: formatSol(networkFeeFor(1)) })}
        />
        <FeeRow label={t('landing.fees.rescue')} amount={<Amount lamports={networkFeeFor(3)} solUsd={solUsd} />} payer={t('landing.fees.rescuePayer')} />
        <FeeRow label={t('landing.fees.deposit')} amount={<Deposit deposit={deposit} solUsd={solUsd} />} payer={t('landing.fees.depositPayer')} />
      </dl>
      {solUsd.status === 'ready' ? (
        <p className="mt-3 text-sm text-muted">{t('landing.fees.usdRate', { rate: formatUsd(1_000_000_000n, solUsd.value) })}</p>
      ) : null}
    </Section>
  );
}
