import { AddressText } from '@stakeward/design-system';
import { SAMPLE, SAMPLE_SIGNATURE } from '../../apps/web/src/pages/dev-ui/samples';

/** Everywhere but a signing screen: short, with copy and a Solana Explorer link. */
export const Short = () => <AddressText address={SAMPLE.stakeA} />;

/** A transaction signature after sending, as /withdraw's Done step shows it: the explorer link opens the transaction. */
export const TransactionSignature = () => (
  <p className="flex flex-wrap items-center gap-x-2 text-sm">
    <span className="text-muted">Transaction</span>
    <AddressText address={SAMPLE_SIGNATURE} kind="tx" />
  </p>
);

/** On a signing screen the whole address, wrapping on narrow screens: a shortened one could be forged. */
export const FullOnSigningScreen = () => (
  <div className="flex max-w-md flex-col gap-1">
    <span className="text-sm font-medium">Second key</span>
    <AddressText address={SAMPLE.secondKey} variant="full" />
  </div>
);

/** In a row's muted line, after its role name: whose stake it is, and the key that holds a lock. */
export const AfterARoleName = () => (
  <div className="flex flex-col gap-1 text-sm text-muted">
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span>Main key</span>
      <AddressText address={SAMPLE.mainKey} />
    </span>
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span>Second key</span>
      <AddressText address={SAMPLE.otherKey} />
    </span>
  </div>
);

/** The recovery card prints every address in full, with copy and the explorer link, under the key's role. */
export const FullOnTheRecoveryCard = () => (
  <dl className="divide-y divide-border rounded-lg border border-border bg-surface">
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="font-semibold">Main key</dt>
      <dd className="flex flex-col gap-1">
        <AddressText address={SAMPLE.mainKey} variant="full" explorer />
        <p className="text-sm text-muted">
          Withdraws the SOL, together with the second key while the lock holds. If it is lost, nobody can withdraw this stake. The
          Solana command line calls it the withdraw authority.
        </p>
      </dd>
    </div>
    <div className="flex flex-col gap-1 px-4 py-3">
      <dt className="font-semibold">Second key</dt>
      <dd className="flex flex-col gap-1">
        <AddressText address={SAMPLE.secondKey} variant="full" explorer />
        <p className="text-sm text-muted">
          Co-signs; it cannot move SOL alone and is not a backup of the main key. The Solana command line calls it the lockup
          custodian.
        </p>
      </dd>
    </div>
  </dl>
);
