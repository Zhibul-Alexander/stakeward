import { formatSol, formatUtcDate, shortAddress, type ClockView } from '@stakeward/core';
import { cn } from 'cn';
import { StatusBadge, type StatusBadgeStatus } from '@/components/product/status-badge';
import type { AccountView } from './view.ts';

/** The classes written out in full: Tailwind only generates utilities it finds in the source. */
const SM_SPAN: Record<number, string> = {
  3: 'sm:col-span-3',
  4: 'sm:col-span-4',
  5: 'sm:col-span-5',
  6: 'sm:col-span-6',
  7: 'sm:col-span-7',
  8: 'sm:col-span-8',
  9: 'sm:col-span-9',
  10: 'sm:col-span-10',
  11: 'sm:col-span-11',
  12: 'sm:col-span-12',
};
const SM_ROWS: Record<number, string> = { 1: 'sm:row-span-1', 2: 'sm:row-span-2', 3: 'sm:row-span-3', 4: 'sm:row-span-4' };

const TONE: Record<StatusBadgeStatus, string> = {
  protected: 'border-success-border bg-success-soft text-success',
  expiring: 'border-warning-border bg-warning-soft text-warning',
  unprotected: 'border-dashed border-border-strong bg-surface text-neutral',
  'locked-by-other': 'border-info-border bg-info-soft text-info',
  'was-protected': 'border-danger-border bg-danger-soft text-danger',
  unknown: 'border-border bg-surface text-muted',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Share of the total, as a float (bigint lamports, so a Number of the ratio in parts per million). */
function shareOf(part: bigint, total: bigint): number {
  return total === 0n ? 0 : Number((part * 1_000_000n) / total) / 1_000_000;
}

/**
 * v10 /app: every stake account of this main key drawn as a strongbox tile, sized by its SOL, so the unlocked share of
 * the stake is visible before any row is read. Status is a word, a colour and an icon (StatusBadge) plus the box's
 * shackle, shut or open. A largest account of about half the stake or more stands as the lead box, spanning the rows
 * of the others; otherwise the boxes flow, each about as wide as its share. Details and actions stay in the rows below.
 */
export function VaultGrid({ rows, clock }: { rows: readonly AccountView[]; clock: ClockView }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.account.lamports, 0n);
  const sorted = [...rows].sort((a, b) => (a.account.lamports === b.account.lamports ? 0 : a.account.lamports > b.account.lamports ? -1 : 1));
  const leadShare = shareOf(sorted[0]!.account.lamports, total);
  const leadMode = sorted.length >= 2 && sorted.length <= 5 && leadShare >= 0.45;
  const leadSpan = clamp(Math.round(leadShare * 12), 6, 8);

  return (
    <section aria-labelledby="vault-grid-title" data-slot="vault-grid" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="vault-grid-title" className="font-display text-lg font-semibold">
          Your stake, to scale
        </h2>
        <p className="text-sm text-muted">Each box is one stake account, sized by its SOL.</p>
      </div>
      <ul role="list" className="grid grid-flow-dense auto-rows-fr grid-cols-6 gap-2 sm:grid-cols-12 sm:gap-3">
        {sorted.map((row, index) => {
          const share = shareOf(row.account.lamports, total);
          const lead = leadMode && index === 0;
          const span = leadMode ? (lead ? leadSpan : 12 - leadSpan) : clamp(Math.round(share * 12), 3, 12);
          const mobile = lead || (!leadMode && share >= 0.5) || sorted.length === 1 ? 'col-span-6' : 'col-span-3';
          return (
            <li
              key={row.account.address}
              className={cn(mobile, SM_SPAN[span], lead ? SM_ROWS[clamp(sorted.length - 1, 1, 4)] : undefined, 'min-w-0')}
            >
              <Tile row={row} clock={clock} lead={lead} share={share} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Tile({ row, clock, lead, share }: { row: AccountView; clock: ClockView; lead: boolean; share: number }) {
  const { account, protection, wasProtected } = row;
  const status: StatusBadgeStatus = protection === 'unprotected' && wasProtected ? 'was-protected' : protection;
  const locked = protection !== 'unprotected';
  const date =
    locked && account.lockup.epoch === 0n && account.lockup.unixTimestamp > 0n && account.lockup.unixTimestamp > clock.unixTimestamp
      ? formatUtcDate(account.lockup.unixTimestamp)
      : null;
  const percent = Math.max(1, Math.round(share * 100));
  return (
    <div className={cn('flex h-full min-h-36 flex-col justify-between gap-3 rounded-lg border-2 p-3 sm:p-4', TONE[status], lead && 'sm:min-h-56')}>
      <div className="flex items-start justify-between gap-2">
        <StatusBadge status={status} secondKeyKnown={row.secondKeyKnown} className="max-w-full min-w-0 bg-surface whitespace-normal" />
        <BoxGlyph locked={locked} className={cn('shrink-0', lead ? 'size-12 sm:size-20' : 'hidden size-8 sm:block')} />
      </div>
      <div className="flex min-w-0 flex-col gap-1 text-foreground">
        <p className={cn('font-display font-semibold tabular-nums', lead ? 'text-2xl sm:text-3xl' : 'text-lg sm:text-2xl')}>
          {formatSol(account.lamports)}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
          <span className="font-mono">{shortAddress(account.address)}</span>
          <span className="tabular-nums">{percent}%</span>
        </p>
        <p className="text-xs text-pretty">{date === null ? (locked ? 'Locked' : 'No lock: the main key withdraws alone') : `Locked until ${date}`}</p>
      </div>
    </div>
  );
}

/** A tiny strongbox: the shackle shut when a lock holds, lifted and open when not. Decorative (the badge says it). */
function BoxGlyph({ locked, className }: { locked: boolean; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className={className}>
      <path
        d={locked ? 'M13 17 V12 a7 7 0 0 1 14 0 V17' : 'M13 13 V8 a7 7 0 0 1 14 0 V9'}
        strokeWidth="2.5"
        strokeLinecap="round"
        className="fill-none stroke-current"
      />
      <rect x="6" y="17" width="28" height="20" rx="2" strokeWidth="2" className="fill-surface stroke-current" />
      <circle cx="15" cy="26" r="3" className={locked ? 'fill-current' : 'fill-none stroke-current'} strokeWidth="1.5" />
      <circle cx="25" cy="26" r="3" className={locked ? 'fill-current' : 'fill-none stroke-current'} strokeWidth="1.5" strokeDasharray={locked ? undefined : '2 2'} />
    </svg>
  );
}
