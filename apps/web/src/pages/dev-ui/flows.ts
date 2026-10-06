import {
  signature,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
  type Address,
  type Signature,
} from '@solana/kit';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  inspectTransaction,
  translateError,
  ZERO_ADDRESS,
  type BlockhashLifetime,
  type ChainClock,
  type ClockView,
  type Lockup,
  type StakeAccount,
} from '@stakeward/core';
import { telegramLinkPath } from '@/api/telegram';
import type { MessageKey } from '@/i18n';
import {
  initialSigningState,
  signingReducer,
  type JobView,
  type RoundTx,
  type SignStep,
  type SigningEvent,
  type SigningState,
} from '@/signing/machine';
import type { ProtectDoneViewProps } from '@/pages/protect/DoneStep';
import { nonceOutcomeItem, type NonceStepViewProps } from '@/signing/NonceStep';
import {
  SAMPLE,
  SAMPLE_ERROR_DETAIL,
  SAMPLE_LOCK_END,
  SAMPLE_SIGNATURE,
  SAMPLE_WALLETS,
  sampleRescueOnNonce,
} from './samples.ts';

/**
 * Fixtures for the flows on /dev/ui: the signing panel in each phase (real transactions built by core and read back by
 * its inspector, states made by the engine's own reducer) and the protect wizard's Done screen. Public addresses only.
 */

const LAMPORTS_PER_SOL = 1_000_000_000n;
const STAKE_RESERVE = 1_666_240n;
const TX: Signature = signature(SAMPLE_SIGNATURE);
const NO_LOCK: Lockup = { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS };
const [WALLET_A, WALLET_B] = SAMPLE_WALLETS;

function sampleStake(address: Address, sol: bigint, lockup: Lockup = NO_LOCK): StakeAccount {
  return {
    address,
    lamports: sol * LAMPORTS_PER_SOL,
    kind: 'initialized',
    rentExemptReserve: STAKE_RESERVE,
    staker: SAMPLE.mainKey,
    withdrawer: SAMPLE.mainKey,
    lockup,
    delegation: null,
  };
}

const locked = (address: Address, sol: bigint) =>
  sampleStake(address, sol, { unixTimestamp: SAMPLE_LOCK_END, epoch: 0n, custodian: SAMPLE.secondKey });

/** `confirm`: the panel asks to tick a box with this label before the wallet is asked (SigningView `confirm`). */
export type SigningSample = { key: string; label: MessageKey; state: SigningState; confirm?: MessageKey };

/** The signing panel of a protect round over two stake accounts, in every phase the panel explains. */
export async function sampleSigningStates(clock: ClockView): Promise<SigningSample[]> {
  const lifetime: BlockhashLifetime = { kind: 'blockhash', blockhash: SAMPLE.blockhash, lastValidBlockHeight: 300_000_000n };
  const chainClock: ChainClock = { ...clock, slot: 300_000_000n, epochStartTimestamp: clock.unixTimestamp };
  const befores = [sampleStake(SAMPLE.stakeC, 3n), sampleStake(SAMPLE.stakeF, 120n)];
  const txs: RoundTx[] = [];
  for (const before of befores) {
    const action = {
      kind: 'protect',
      stakeAccount: before.address,
      mainKey: SAMPLE.mainKey,
      secondKey: SAMPLE.secondKey,
      lockUntil: SAMPLE_LOCK_END,
    } as const;
    const { bytes } = buildTransaction(action, { feePayer: SAMPLE.mainKey, lifetime });
    const inspected = await inspectTransaction(bytes);
    if (!inspected.ok) throw new Error(`the sample protect transaction was refused: ${inspected.error.message}`);
    txs.push({ id: before.address, bytes, summary: inspected.summary, lifetime });
  }
  const ids = befores.map((before) => before.address);
  const jobs: Record<string, JobView> = Object.fromEntries(
    txs.map((tx, index) => [
      tx.id,
      { id: tx.id, state: { kind: 'ready' }, before: befores[index] ?? null, action: tx.summary.action, lifetime, signature: null, bytes: tx.bytes },
    ]),
  );
  const steps = (secondWallet: string | null, mainWallet: string = WALLET_A.name): SignStep[] => [
    { address: SAMPLE.mainKey, role: 'main', walletName: mainWallet, count: 2, status: 'pending', local: true },
    { address: SAMPLE.secondKey, role: 'second', walletName: secondWallet, count: 2, status: 'pending', local: true },
  ];
  const signedBy = (...signers: Address[]): RoundTx[] =>
    txs.map((tx) => ({ ...tx, summary: { ...tx.summary, presentSignatures: signers } }));
  const reduce = (state: SigningState, ...events: SigningEvent[]): SigningState => events.reduce(signingReducer, state);
  const idle = initialSigningState(ids, 2);
  const prepared = (secondWallet: string | null, mainWallet?: string) =>
    reduce(idle, { type: 'start' }, { type: 'prepared', clock: chainClock, jobs, txs, steps: steps(secondWallet, mainWallet) });
  const ready = prepared(WALLET_B.name);
  const afterMain = (state: SigningState) => reduce(state, { type: 'asking', step: 0 }, { type: 'signed', step: 0, txs: signedBy(SAMPLE.mainKey) });
  const bothSigned = reduce(
    afterMain(ready),
    { type: 'asking', step: 1 },
    { type: 'signed', step: 1, txs: signedBy(SAMPLE.mainKey, SAMPLE.secondKey) },
  );
  const rejected = translateError(Object.assign(new Error('User rejected the request.'), { code: 4001 }));
  // One stake account per round: round 1 (C) landed, round 2 (F) was declined by the second wallet.
  const [txC, txF] = txs as [RoundTx, RoundTx];
  const single = (tx: RoundTx): SigningEvent => ({
    type: 'prepared',
    clock: chainClock,
    jobs: { [tx.id]: jobs[tx.id] as JobView },
    txs: [tx],
    steps: steps(WALLET_B.name).map((step) => ({ ...step, count: 1 })),
  });
  const signedOne = (tx: RoundTx, ...signers: Address[]): RoundTx => ({ ...tx, summary: { ...tx.summary, presentSignatures: signers } });
  const laterRound = reduce(
    initialSigningState(ids, 1),
    { type: 'start' },
    single(txC),
    { type: 'asking', step: 0 },
    { type: 'signed', step: 0, txs: [signedOne(txC, SAMPLE.mainKey)] },
    { type: 'asking', step: 1 },
    { type: 'signed', step: 1, txs: [signedOne(txC, SAMPLE.mainKey, SAMPLE.secondKey)] },
    { type: 'job', id: txC.id, state: { kind: 'confirming', indefinite: false }, signature: TX },
    { type: 'send-done' },
    { type: 'job', id: txC.id, state: { kind: 'checking' } },
    { type: 'confirm-done' },
    { type: 'job', id: txC.id, state: { kind: 'done', after: locked(SAMPLE.stakeC, 3n) } },
    { type: 'check-done' },
    single(txF),
    { type: 'asking', step: 0 },
    { type: 'signed', step: 0, txs: [signedOne(txF, SAMPLE.mainKey)] },
    { type: 'asking', step: 1 },
    { type: 'stopped', step: 1, reason: { kind: 'wallet', walletName: WALLET_B.name, error: rejected, portError: null } },
  );

  return [
    { key: 'idle', label: 'devUi.flows.idle', state: idle },
    { key: 'ready-batch', label: 'devUi.flows.readyBatch', state: ready },
    { key: 'ready-same-wallet', label: 'devUi.flows.readySameWallet', state: afterMain(prepared(WALLET_A.name)) },
    { key: 'needs-wallet', label: 'devUi.flows.needsWallet', state: reduce(afterMain(prepared(null)), { type: 'needs-wallet', step: 1 }) },
    {
      key: 'switch-account',
      label: 'devUi.flows.switchAccount',
      state: reduce(afterMain(prepared(WALLET_A.name)), { type: 'switch-account', step: 1, again: false }),
    },
    { key: 'starting', label: 'devUi.flows.starting', state: reduce(ready, { type: 'starting', step: 0, waitFor: 'network' }) },
    { key: 'signing', label: 'devUi.flows.signing', state: reduce(ready, { type: 'asking', step: 0 }) },
    {
      key: 'stopped-check',
      label: 'devUi.flows.stoppedCheck',
      state: reduce(afterMain(ready), { type: 'asking', step: 1 }, {
        type: 'stopped',
        step: 1,
        reason: {
          kind: 'check',
          walletName: WALLET_B.name,
          code: 'tail-not-first-signer',
          detail: 'The wallet appended Lighthouse instructions to a transaction that was already signed',
          startWith: SAMPLE.secondKey,
          bothWays: false,
        },
      }),
    },
    {
      key: 'stopped-wallet',
      label: 'devUi.flows.stoppedWallet',
      state: reduce(ready, { type: 'asking', step: 0 }, {
        type: 'stopped',
        step: 0,
        reason: { kind: 'wallet', walletName: WALLET_A.name, error: rejected, portError: null },
      }),
    },
    { key: 'later-round', label: 'devUi.flows.laterRound', state: laterRound },
    { key: 'expired', label: 'devUi.flows.expired', state: reduce(afterMain(ready), { type: 'expired' }) },
    {
      key: 'sending',
      label: 'devUi.flows.sending',
      state: reduce(bothSigned, { type: 'job', id: SAMPLE.stakeC, state: { kind: 'sending' }, signature: TX }),
    },
    {
      key: 'confirming',
      label: 'devUi.flows.confirming',
      state: reduce(
        bothSigned,
        { type: 'job', id: SAMPLE.stakeC, state: { kind: 'confirming', indefinite: false }, signature: TX },
        { type: 'job', id: SAMPLE.stakeF, state: { kind: 'confirming', indefinite: false }, signature: TX },
        { type: 'send-done' },
      ),
    },
    {
      key: 'fee-balance',
      label: 'devUi.flows.feeBalance',
      state: reduce(idle, { type: 'start' }, {
        type: 'prepare-failed',
        problem: { kind: 'fee-balance', payer: SAMPLE.mainKey, role: 'main', balance: 1_000n, needed: 900_000n },
      }),
    },
  ];
}

/**
 * Signing by link (spec step 7 section 11): a rescue of stake A to the new wallet on its durable nonce, one
 * transaction. On the first device the new wallet and the main key sign here and the second key signs by link (link
 * open, then paused after 30 minutes). On the device that opened the link the second key is the one signer left, and
 * the page asks for a confirmation first (`confirm`, the /cosign look).
 */
export async function sampleLinkStates(clock: ClockView): Promise<SigningSample[]> {
  const { bytes, lifetime } = await sampleRescueOnNonce();
  const inspected = await inspectTransaction(bytes);
  if (!inspected.ok) throw new Error(`the sample rescue transaction was refused: ${inspected.error.message}`);
  const chainClock: ChainClock = { ...clock, slot: 300_000_000n, epochStartTimestamp: clock.unixTimestamp };
  const tx: RoundTx = { id: SAMPLE.stakeA, bytes, summary: inspected.summary, lifetime };
  const job: JobView = {
    id: tx.id,
    state: { kind: 'ready' },
    before: locked(SAMPLE.stakeA, 1_250n),
    action: tx.summary.action,
    lifetime,
    signature: null,
    bytes,
  };
  const signedBy = (...signers: Address[]): RoundTx => ({ ...tx, summary: { ...tx.summary, presentSignatures: signers } });
  const step = (address: Address, role: SignStep['role'], walletName: string | null, local: boolean): SignStep => ({
    address,
    role,
    walletName,
    count: 1,
    status: 'pending',
    local,
  });
  const reduce = (state: SigningState, ...events: SigningEvent[]): SigningState => events.reduce(signingReducer, state);
  const linkOpen = reduce(
    initialSigningState([tx.id], 1),
    { type: 'start' },
    {
      type: 'prepared',
      clock: chainClock,
      jobs: { [tx.id]: job },
      txs: [tx],
      steps: [
        step(SAMPLE.newWallet, 'new', WALLET_B.name, true),
        step(SAMPLE.mainKey, 'main', WALLET_A.name, true),
        step(SAMPLE.secondKey, 'second', null, false),
      ],
    },
    { type: 'asking', step: 0 },
    { type: 'signed', step: 0, txs: [signedBy(SAMPLE.newWallet)] },
    { type: 'asking', step: 1 },
    { type: 'signed', step: 1, txs: [signedBy(SAMPLE.newWallet, SAMPLE.mainKey)], signature: TX },
  );
  // The device that opened the link: the bytes already carry the new wallet's and the main key's signatures.
  const cosign = reduce(initialSigningState([tx.id], 1), { type: 'start' }, {
    type: 'prepared',
    clock: chainClock,
    jobs: { [tx.id]: job },
    txs: [signedBy(SAMPLE.newWallet, SAMPLE.mainKey)],
    steps: [step(SAMPLE.secondKey, 'second', WALLET_A.name, true)],
  });
  return [
    { key: 'link-watching', label: 'devUi.flows.linkWatching', state: linkOpen },
    { key: 'link-paused', label: 'devUi.flows.linkPaused', state: reduce(linkOpen, { type: 'link-paused' }) },
    { key: 'cosign-confirm', label: 'devUi.flows.cosignConfirm', state: cosign, confirm: 'devUi.sample.confirmRescue' },
  ];
}

/** NonceStepView as a page shows it (`onStart` is the page's), or NonceGate's notice for a taken address. */
export type NonceSample =
  | { key: string; label: MessageKey; kind: 'step'; props: Omit<NonceStepViewProps, 'onStart' | 'headingRef'> }
  | { key: string; label: MessageKey; kind: 'gate-blocked' };

/** Rent for an 80-byte nonce account at 6960 lamports per byte-year (the deposit a setup locks). */
export const SAMPLE_NONCE_DEPOSIT = 1_447_680n;

/**
 * The link-signing account's cards: set up by the main key (protect or withdraw by link) and by the new wallet for a
 * rescue, close and cancel a link by the new wallet (rescue), a setup refused because the address is taken, and the
 * gate's notice for that case.
 */
export async function sampleNonceSteps(): Promise<NonceSample[]> {
  const nonceAccount = await deriveNonceAccountAddress(SAMPLE.mainKey);
  const refused: JobView = {
    id: nonceAccount,
    state: { kind: 'refused', reason: 'nonce-unusable' },
    before: null,
    action: null,
    lifetime: null,
    signature: null,
    bytes: null,
  };
  return [
    { key: 'setup', label: 'devUi.flows.nonceSetup', kind: 'step', props: { mode: 'setup', role: 'main', amount: SAMPLE_NONCE_DEPOSIT } },
    {
      key: 'setup-rescue',
      label: 'devUi.flows.nonceSetupRescue',
      kind: 'step',
      props: { mode: 'setup', variant: 'rescue', role: 'new', amount: SAMPLE_NONCE_DEPOSIT },
    },
    { key: 'close', label: 'devUi.flows.nonceClose', kind: 'step', props: { mode: 'close', role: 'new', amount: SAMPLE_NONCE_DEPOSIT } },
    {
      key: 'cancel-link',
      label: 'devUi.flows.nonceCancel',
      kind: 'step',
      props: { mode: 'close', variant: 'cancel-link', role: 'new', amount: SAMPLE_NONCE_DEPOSIT },
    },
    {
      key: 'blocked',
      label: 'devUi.flows.nonceBlocked',
      kind: 'step',
      props: { mode: 'setup', role: 'main', amount: SAMPLE_NONCE_DEPOSIT, outcome: nonceOutcomeItem(refused) },
    },
    { key: 'gate-blocked', label: 'devUi.flows.nonceGateBlocked', kind: 'gate-blocked' },
  ];
}

export type DoneSample = { key: string; label: MessageKey; props: Omit<ProtectDoneViewProps, 'actions'> };

function outcome(id: Address, state: JobView['state'], signature: Signature | null = null): JobView {
  return { id, state, before: null, action: null, lifetime: null, signature, bytes: null };
}

const done = (id: Address, after: StakeAccount): JobView => outcome(id, { kind: 'done', after }, TX);

/** The protect wizard's Done screen: everything protected, part of it, nothing. */
export function sampleDoneViews(clock: ClockView): DoneSample[] {
  const rateLimited = translateError(
    new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: 'Too Many Requests', statusCode: 429 }),
  );
  const common = {
    clock,
    mainKey: SAMPLE.mainKey,
    secondKey: SAMPLE.secondKey,
    lockUntil: SAMPLE_LOCK_END,
    telegramUrl: telegramLinkPath(SAMPLE.mainKey),
  };
  return [
    {
      key: 'all',
      label: 'devUi.flows.all',
      props: {
        ...common,
        outcomes: [
          done(SAMPLE.stakeC, locked(SAMPLE.stakeC, 3n)),
          outcome(SAMPLE.stakeA, { kind: 'already-done', after: locked(SAMPLE.stakeA, 1_250n) }),
        ],
        watch: { kind: 'on' },
      },
    },
    {
      key: 'partial',
      label: 'devUi.flows.partial',
      props: {
        ...common,
        outcomes: [
          done(SAMPLE.stakeC, locked(SAMPLE.stakeC, 3n)),
          outcome(SAMPLE.stakeF, { kind: 'failed', error: rateLimited }, TX),
          outcome(SAMPLE.stakeH, { kind: 'unknown', why: 'timeout' }, TX),
          outcome(SAMPLE.stakeI, { kind: 'refused', reason: 'lock-end-passed' }),
        ],
        watch: { kind: 'failed', detail: SAMPLE_ERROR_DETAIL.fetch },
      },
    },
    {
      key: 'none',
      label: 'devUi.flows.none',
      props: {
        ...common,
        outcomes: [
          outcome(SAMPLE.stakeD, { kind: 'refused', reason: 'locked-by-other' }),
          outcome(SAMPLE.stakeG, { kind: 'expired' }, TX),
          outcome(SAMPLE.stakeJ, { kind: 'not-sent' }),
        ],
        watch: { kind: 'idle' },
      },
    },
  ];
}
