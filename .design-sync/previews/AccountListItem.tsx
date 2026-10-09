import { AccountList, AccountListItem, AccountRow, AddressText } from '@stakeward/design-system';
import { scannerStatus, stakeActivationStatus } from '@stakeward/core';
import { appLinks } from '../../apps/web/src/pages/app/view';
import type { Signature } from '@solana/kit';
import { SAMPLE, SAMPLE_TX, sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) so the dates in the cards never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const samples = sampleRows(clock);
const accountsOf = (...keys: SampleRow['key'][]) =>
  keys.flatMap((key) => samples.filter((row) => row.key === key).map((row) => row.account));
const known = [SAMPLE.secondKey];

/**
 * Each item holds one AccountRow and gives it the list's padding; the hairline between items comes from the list. As
 * /protect lists "Already protected": no actions, the way to change a lock as a link in the row's muted line.
 */
export const ItemsWithRows = () => (
  <AccountList label="Already protected (2)">
    {accountsOf('protected', 'expiring').map((account) => {
      const view = scannerStatus(account, known, clock);
      return (
        <AccountListItem key={account.address}>
          <AccountRow
            account={account}
            activation={stakeActivationStatus(account.delegation, clock.epoch)}
            clock={clock}
            protection={view.status}
            managedByService={view.managedByService}
            secondKeyKnown
            hint={false}
            meta={
              <a
                href={`/extend/${account.address}`}
                onClick={(event) => {
                  event.preventDefault();
                }}
                className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
                Extend the lock
              </a>
            }
          />
        </AccountListItem>
      );
    })}
  </AccountList>
);

// Both accounts as the network reads them after a 6-month protect: locked until 10 April 2027 by the second key.
const LOCK_END = 1_807_315_200n;
// One transaction per stake account, so each row carries its own signature.
const SIGNATURES: readonly Signature[] = [
  SAMPLE_TX,
  '3WTm5Vi5orNsqL73DAKHyVpqu2AAUj2JzJW1yX9u2SacvRVgUpsDrTRrcWvYq8QS7pMkMivWQPo9Nv4oxrYDr6GM' as Signature,
];
const afterProtect = accountsOf('protected', 'unprotected').map((account, index) => ({
  account: { ...account, lockup: { unixTimestamp: LOCK_END, epoch: 0n, custodian: SAMPLE.secondKey } },
  signature: SIGNATURES[index] ?? SAMPLE_TX,
}));

/**
 * /protect's done step: each item holds a row read back from the network, its own transaction in the row's muted line.
 */
export const AfterProtecting = () => (
  <AccountList label="Protected">
    {afterProtect.map(({ account, signature }) => {
      const view = scannerStatus(account, known, clock);
      return (
        <AccountListItem key={account.address}>
          <AccountRow
            account={account}
            activation={stakeActivationStatus(account.delegation, clock.epoch)}
            clock={clock}
            protection={view.status}
            managedByService={view.managedByService}
            secondKeyKnown
            rescueHref={appLinks.rescue(account.withdrawer)}
            hint={false}
            serviceDetail
            meta={
              <span className="inline-flex flex-wrap items-center gap-x-1">
                <span>Transaction</span>
                <AddressText address={signature} kind="tx" />
              </span>
            }
          />
        </AccountListItem>
      );
    })}
  </AccountList>
);
