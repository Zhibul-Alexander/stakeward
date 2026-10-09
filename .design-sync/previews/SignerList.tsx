import { SignerList } from '@stakeward/design-system';
import { SAMPLE, SAMPLE_WALLETS, sampleSigners } from '../../apps/web/src/pages/dev-ui/samples';

// The signing panel shows the compact order above the summary (signing/SigningPanel.tsx); each status comes from the
// round as signing/view.ts signerItems reads it: only the key whose turn it is can be current, switching or stopped.
const [walletA, walletB] = SAMPLE_WALLETS;

/** Protect two stake accounts: the Main key has signed both, now the Second key approves both in one request. */
export const SecondKeysTurn = () => <SignerList items={sampleSigners()} />;

/** The same round in the compact order above a signing summary (the summary holds the full addresses). */
export const Compact = () => <SignerList items={sampleSigners()} variant="compact" />;

/** Rescue on a durable nonce, one stake account per round: the New wallet paid and signed, the Main key is next here,
 * the Second key signs by link. */
export const RescueByLink = () => (
  <SignerList
    variant="compact"
    items={[
      { role: 'new', walletName: walletA.name, address: SAMPLE.newWallet, count: 1, status: 'signed' },
      { role: 'main', walletName: walletB.name, address: SAMPLE.mainKey, count: 1, status: 'current' },
      { role: 'second', walletName: null, address: SAMPLE.secondKey, count: 1, status: 'link' },
    ]}
  />
);

/** Protect two stake accounts: the Main key signed, then the Second key's wallet declined. */
export const Stopped = () => (
  <SignerList
    variant="compact"
    items={[
      { role: 'main', walletName: walletA.name, address: SAMPLE.mainKey, count: 2, status: 'signed' },
      { role: 'second', walletName: walletB.name, address: SAMPLE.secondKey, count: 2, status: 'stopped' },
    ]}
  />
);

/** One wallet holds both keys: after the Main key signed, it offers the wrong account until the user switches. */
export const SwitchAccount = () => (
  <SignerList
    variant="compact"
    items={[
      { role: 'main', walletName: walletA.name, address: SAMPLE.mainKey, count: 2, status: 'signed' },
      { role: 'second', walletName: walletA.name, address: SAMPLE.secondKey, count: 2, status: 'switch' },
    ]}
  />
);

/** Rescue: the New wallet signed, the Main key is not connected in this browser yet, the Second key waits. */
export const NeedsWallet = () => (
  <SignerList
    variant="compact"
    items={[
      { role: 'new', walletName: walletA.name, address: SAMPLE.newWallet, count: 1, status: 'signed' },
      { role: 'main', walletName: null, address: SAMPLE.mainKey, count: 1, status: 'missing' },
      { role: 'second', walletName: walletB.name, address: SAMPLE.secondKey, count: 1, status: 'waiting' },
    ]}
  />
);
