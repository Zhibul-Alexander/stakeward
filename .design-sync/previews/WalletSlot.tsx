import { WalletSlot } from '@stakeward/design-system';
import { SAMPLE, SAMPLE_WALLETS } from '../../apps/web/src/pages/dev-ui/samples';

// Sample wallets with neutral icons (not real wallet brands), as /dev/ui uses them. Each cell is a state KeySlot
// (pages/app/KeySlot.tsx) gives WalletSlot on a real screen, with that screen's description and emphasis.
const [walletA, walletB] = SAMPLE_WALLETS;
const noop = () => undefined;

/** Rescue, New wallet step: the New wallet connected, with what it does here and Disconnect. */
export const Connected = () => (
  <WalletSlot
    role="new"
    status="connected"
    wallet={walletA}
    address={SAMPLE.newWallet}
    onDisconnect={noop}
    emphasis="outline"
    description="It signs, pays the fees and holds a small deposit. Connecting signs nothing."
  />
);

/** Protect, Second key step: Connect pressed, every Wallet Standard wallet found in this browser listed. */
export const ChooseAWallet = () => (
  <WalletSlot
    role="second"
    status="empty"
    wallets={SAMPLE_WALLETS}
    onConnect={noop}
    emphasis="primary"
    defaultPickerOpen
    description="Connecting signs nothing."
  />
);

/** Waiting for the wallet to approve the connection, with a way out (Cancel). */
export const Connecting = () => (
  <WalletSlot role="second" status="connecting" wallet={walletB} onCancel={noop} emphasis="primary" description="Connecting signs nothing." />
);

/** The connect request was declined in the wallet: the product's words, the raw error under Details, try again or
 * pick another wallet. */
export const ConnectionFailed = () => (
  <WalletSlot
    role="second"
    status="error"
    wallet={walletB}
    message="The request was declined in the wallet. Nothing was sent; you can try again."
    detail="WalletConnectionError: User rejected the request."
    onRetry={noop}
    onCancel={noop}
    emphasis="primary"
    description="Connecting signs nothing."
  />
);

/** The wallet gave the Main key's account for the Second key: switch accounts in the wallet, then Continue. */
export const WrongAccount = () => (
  <WalletSlot
    role="second"
    status="wrong-account"
    wallet={walletA}
    address={SAMPLE.mainKey}
    conflictRole="main"
    onContinue={noop}
    onDisconnect={noop}
    emphasis="primary"
    description="Connecting signs nothing."
  />
);

/** /app, nothing connected yet: the inline outline "Connect main key" beside the address form. */
export const InlineEmpty = () => (
  <WalletSlot role="main" status="empty" wallets={SAMPLE_WALLETS} onConnect={noop} layout="inline" connectLabel="Connect main key" />
);

/** /app, the Main key connected: the same slot as one line with copy, explorer and Disconnect. */
export const InlineConnected = () => (
  <WalletSlot role="main" status="connected" wallet={walletA} address={SAMPLE.mainKey} onDisconnect={noop} layout="inline" connectLabel="Connect main key" />
);
