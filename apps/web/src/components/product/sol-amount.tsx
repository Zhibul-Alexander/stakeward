import { formatSol } from '@stakeward/core';
import { cn } from 'cn';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Lamports as SOL with every decimal that matters: integer arithmetic in core `formatSol` (no floating point), so
 * 1 lamport is 0.000000001 SOL and u64::MAX lamports print exactly. Tabular digits keep columns aligned.
 */
export function SolAmount({ lamports, className }: { lamports: bigint; className?: string | undefined }) {
  return (
    <span data-slot="sol-amount" data-lamports={lamports.toString()} className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatSol(lamports)}
    </span>
  );
}

export function SolAmountSkeleton({ className }: { className?: string | undefined }) {
  return <Skeleton className={cn('inline-block h-5 w-24 align-middle', className)} />;
}
