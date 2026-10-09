import type { Signature } from '@solana/kit';
import { JobStatusList } from '@stakeward/design-system';
import { SAMPLE, SAMPLE_ERROR_DETAIL } from '../../apps/web/src/pages/dev-ui/samples';

// One transaction per stake account, so every row that has one carries its own fee-payer signature (random bytes,
// base58), the explorer link of that transaction.
const TX = {
  a: 'RnFVobfdfL2C1u9cfNTsWzJcJtDWDcNxdFZPTusQTjbfMu7ssfhZ3MaFdiFacTPyMs8ww5tn3RrCjqmZUjzv39G',
  b: '3Pc1H7FyvJujAG2enNbE5fEcfGGFCukeYoiRdnhbmV9b7dAsEi82S64sLTnYGzKZATJv6JD2tFTBRC8HXZ5n5Dht',
  c: '4MNHSvpEUHEv7qL1rZ5h236AYtMNZrkjDqroJBUbf8vQsnuFvsFAmUkp8UpuxH6y81ddTqzcycrPyFP47GCV5QSj',
  g: '3i7VAZEVEBvJvZATabdYXFUeFigsSb767EKkWtrpM3tiakWwZ5G2HUVRcPHWa4Yh9G32D3mCCdfZUfA3qN354Gpa',
  h: '3JFybsBLVyJxQDeziguybw5BLtRPyGeCfLiXq61vtcGByEnKKLz7pcDCYUymUURsnKXJ4AE6hEr6Zv46m12PTEMV',
} as Record<string, Signature>;

/** Protect two stake accounts: they are independent, so one is done while the other did not go through. */
export const PartialSuccess = () => (
  <JobStatusList
    label="Stake accounts"
    items={[
      { address: SAMPLE.stakeA, status: 'done', signature: TX.a },
      {
        address: SAMPLE.stakeB,
        status: 'failed',
        reason: 'Too many requests. Wait a minute and try again.',
        detail: SAMPLE_ERROR_DETAIL.rateLimited,
        signature: TX.b,
      },
    ]}
  />
);

/**
 * A round being sent: transactions go out one after another, so the ones already sent are confirming, one is sending
 * and the rest are still waiting (no transaction link until it is sent).
 */
export const InProgress = () => (
  <JobStatusList
    label="Stake accounts"
    items={[
      { address: SAMPLE.stakeA, status: 'confirming', signature: TX.a },
      { address: SAMPLE.stakeB, status: 'confirming', signature: TX.b },
      { address: SAMPLE.stakeC, status: 'sending', signature: TX.c },
      { address: SAMPLE.stakeD, status: 'waiting' },
    ]}
  />
);

/**
 * After the whole round's confirmation poll: confirmed transactions are read back on chain before they count as done;
 * the others already have their outcome (here one expired).
 */
export const Checking = () => (
  <JobStatusList
    label="Stake accounts"
    items={[
      { address: SAMPLE.stakeA, status: 'checking', signature: TX.a },
      { address: SAMPLE.stakeB, status: 'checking', signature: TX.b },
      {
        address: SAMPLE.stakeC,
        status: 'expired',
        reason: 'This transaction expired before it reached the network. Nothing changed; try again.',
        signature: TX.c,
      },
    ]}
  />
);

/**
 * Outcomes that are not plain success, as Stop waiting during a send leaves them: one expired before it reached the
 * network, the one in flight is not confirmed yet, and the rest were not sent.
 */
export const OtherOutcomes = () => (
  <JobStatusList
    label="Stake accounts"
    items={[
      {
        address: SAMPLE.stakeG,
        status: 'expired',
        reason: 'This transaction expired before it reached the network. Nothing changed; try again.',
        signature: TX.g,
      },
      {
        address: SAMPLE.stakeH,
        status: 'unknown',
        reason: 'You stopped waiting. It may still go through: check again.',
        signature: TX.h,
      },
      { address: SAMPLE.stakeI, status: 'not-sent' },
    ]}
  />
);

/** Protect: chosen, read again before signing and left out of this request, each with protect's reason. */
export const LeftOut = () => (
  <div className="flex flex-col gap-2">
    <p className="text-sm font-medium">2 stake accounts are not in this request:</p>
    <JobStatusList
      label="2 stake accounts are not in this request:"
      items={[
        {
          address: SAMPLE.stakeI,
          status: 'left-out',
          reason: 'Another key has locked this stake account. Only that key can change the lock.',
        },
        {
          address: SAMPLE.stakeJ,
          status: 'left-out',
          reason: 'Already locked by your second key with another end date. To change the date, extend the lock.',
        },
      ]}
    />
  </div>
);
