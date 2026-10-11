import { ProtectionCheck, type ProtectionCheckLinks } from '@stakeward/design-system';
import { setupCheck } from '@stakeward/core';
import { telegramLinkPath } from '../../apps/web/src/api/telegram';
import { appLinks } from '../../apps/web/src/pages/app/view';
import { SAMPLE, SAMPLE_ERROR_DETAIL, sampleRows } from '../../apps/web/src/pages/dev-ui/samples';

// The check under /app's account lists, decided by core `setupCheck` as ProtectionCheckSection calls it: the second
// key this browser knows, the worker's rescue kits, alerts unknown (the site never learns them). Fixed clock: 9 October 2026.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const rows = sampleRows(clock);
const account = (address: string) => rows.find((row) => row.account.address === address)!.account;
const noop = () => undefined;

const links: ProtectionCheckLinks = {
  protect: appLinks.protect,
  extend: appLinks.extend,
  rescue: appLinks.rescue(SAMPLE.mainKey),
  rescueKit: '/rescue-kit',
  telegram: telegramLinkPath(SAMPLE.mainKey),
  recovery: appLinks.recovery,
};

const needsFixes = setupCheck({
  mainKey: SAMPLE.mainKey,
  accounts: [account(SAMPLE.stakeA), account(SAMPLE.stakeB), account(SAMPLE.stakeC)],
  clock,
  knownSecondKeys: [SAMPLE.secondKey],
  rescueKits: { [SAMPLE.stakeA]: 'ready', [SAMPLE.stakeB]: 'ready' },
});

const allPass = setupCheck({
  mainKey: SAMPLE.mainKey,
  accounts: [account(SAMPLE.stakeA)],
  clock,
  knownSecondKeys: [SAMPLE.secondKey],
  rescueKits: { [SAMPLE.stakeA]: 'ready' },
});

const empty = setupCheck({ mainKey: SAMPLE.mainKey, accounts: [], clock, knownSecondKeys: [], rescueKits: {} });

/** One stake unlocked and one lock ending on 28 October 2026: the two failing rows open with their fix. */
export const NeedsFixes = () => <ProtectionCheck state="ready" result={needsFixes} links={links} />;

/** One stake locked until 12 April 2027 with a ready kit: every scored check passes, rows fold away. */
export const AllPass = () => <ProtectionCheck state="ready" result={allPass} links={links} />;

/** While the rescue kits are read: four row placeholders under the title. */
export const Loading = () => <ProtectionCheck state="loading" />;

/** DS-only state: /app renders the check only when the main key owns a stake account. */
export const NothingToCheck = () => <ProtectionCheck state="ready" result={empty} links={links} />;

/** DS-only state: /app never fails the check (an unreadable kit reads Unknown); shown for completeness. */
export const CouldNotRun = () => (
  <ProtectionCheck
    state="error"
    message="The Solana network did not respond. Check your connection and try again."
    detail={SAMPLE_ERROR_DETAIL.rpc}
    onRetry={noop}
  />
);
