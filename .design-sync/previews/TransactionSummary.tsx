import { TransactionSummary, TransactionSummarySkeleton } from '@stakeward/design-system';
import { useEffect, useState } from 'react';
import { sampleSummaries, type SampleSummary } from '../../apps/web/src/pages/dev-ui/samples';

// Real inspector output: core builds each transaction, then reads it back from its bytes, as a signing screen does.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const summaries = sampleSummaries(clock);

function Summary({ sampleKey }: { sampleKey: string }) {
  const [sample, setSample] = useState<SampleSummary | null>(null);
  useEffect(() => {
    void summaries.then((all) => {
      setSample(all.find((one) => one.key === sampleKey) ?? null);
    });
  }, [sampleKey]);
  if (sample === null || !sample.ok) return <TransactionSummarySkeleton />;
  return <TransactionSummary summary={sample.summary} current={sample.current} batch={sample.batch} headingLevel={3} />;
}

/** Protect two stake accounts in one request: now -> after, who signs, the fee, and what it cannot do. */
export const ProtectTwoAccounts = () => <Summary sampleKey="protect-batch" />;

/** Withdraw the whole balance to the main key: both keys sign while the lock holds. */
export const Withdraw = () => <Summary sampleKey="withdraw" />;

/** Rescue to a new wallet on a durable nonce: three signers, the new wallet pays. */
export const Rescue = () => <Summary sampleKey="rescue" />;

/** Remove the lock early: only the second key signs. */
export const RemoveLock = () => <Summary sampleKey="unlock" />;
