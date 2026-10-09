// The QA suite's view of the cluster, from Node (.claude/skills/qa-e2e/SKILL.md). One code path for both targets:
// keys are funded, stake accounts are created and delegated with ordinary transactions over JSON-RPC, and every result
// is checked by reading the chain (CLAUDE.md section 12), never by trusting what the page said.
//   local: the LiteSVM chain of qa/local/chain-server.ts; funding is an airdrop; /qa/* controls (epochs, faults).
//   dev:   devnet; funding comes from the devnet funder key (.keys/devnet-funder.json, the one scripts/dev-accounts
//          uses), topped up by airdrop when low; leftover SOL goes back to it after each test (sweep).
// Test-only code: these keys are throwaway test keys, generated in memory. The product never sees a private key.
import { existsSync, readFileSync } from 'node:fs';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
  type Signature,
  type TransactionSigner,
} from '@solana/kit';
import {
  buildTransaction,
  decodeStakeAccount,
  GENESIS_HASH,
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  type StakeAccount,
} from '@stakeward/core';
import { loadOrCreateKey } from '../../../../scripts/gate/keys.ts';
import { QA } from './env.ts';

const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const SYSVAR_RENT = address('SysvarRent111111111111111111111111111111111');
const LAMPORTS_PER_SOL = 1_000_000_000n;
const FEE_RESERVE = 1_000_000n; // left on a swept key so the sweep itself can pay

export type Lockup = StakeAccount['lockup'];

export class QaChain {
  readonly target = QA.target;
  readonly rpcUrl = QA.rpcUrl;
  private funder: KeyPairSigner | null = null;
  private readonly created: KeyPairSigner[] = [];

  /** Raw JSON-RPC. Retries 429 and network errors (public devnet RPC rate-limits). */
  async rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetch(this.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        });
        if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${String(response.status)}`);
        const body = (await response.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
        if (body.error !== undefined) {
          throw Object.assign(new Error(`${method}: ${body.error.message}`), { rpc: body.error, final: true });
        }
        return body.result as T;
      } catch (error) {
        if ((error as { final?: boolean }).final === true || attempt >= 6) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }

  /** Refuses to run against anything but devnet (or the local chain, which reports devnet's genesis hash). */
  async assertDevnet(): Promise<void> {
    const hash = await this.rpc<string>('getGenesisHash');
    if (hash !== GENESIS_HASH.devnet) throw new Error(`QA RPC ${this.rpcUrl} is not devnet (genesis ${hash}); refusing`);
  }

  async balance(target: Address): Promise<bigint> {
    return BigInt((await this.rpc<{ value: number }>('getBalance', [target, { commitment: 'confirmed' }])).value);
  }

  async account(target: Address): Promise<{ data: Uint8Array; lamports: bigint; owner: Address } | null> {
    const { value } = await this.rpc<{ value: { data: [string, string]; lamports: number; owner: string } | null }>(
      'getAccountInfo',
      [target, { encoding: 'base64', commitment: 'confirmed' }],
    );
    if (value === null) return null;
    return {
      data: Uint8Array.from(getBase64Encoder().encode(value.data[0])),
      lamports: BigInt(value.lamports),
      owner: address(value.owner),
    };
  }

  /** The stake account as the chain holds it now, or null once it is closed. */
  async stake(target: Address): Promise<StakeAccount | null> {
    const raw = await this.account(target);
    if (raw === null) return null;
    const decoded = decodeStakeAccount({ address: target, ...raw });
    if (!decoded.ok) throw new Error(`${target} is not a stake account: ${decoded.error}`);
    return decoded.account;
  }

  // ---- Keys and funding ----

  /** A new throwaway key holding `sol` SOL. Swept back to the funder by {@link sweep} (dev). */
  async newKey(sol: number): Promise<KeyPairSigner> {
    const key = await generateKeyPairSigner();
    this.created.push(key);
    await this.fund(key.address, sol);
    return key;
  }

  async fund(target: Address, sol: number): Promise<void> {
    const lamports = BigInt(Math.round(sol * 1e9));
    if (this.target === 'local') {
      await this.control('fund', { address: target, sol });
      return;
    }
    const funder = await this.devnetFunder(lamports + LAMPORTS_PER_SOL / 100n);
    await this.send(funder, [transferInstruction(funder, target, lamports)]);
  }

  /** dev: returns what the test keys still hold to the funder (best effort; keys that hold nothing are skipped). */
  async sweep(): Promise<void> {
    if (this.target === 'local' || this.funder === null) return;
    for (const key of this.created.splice(0)) {
      try {
        const balance = await this.balance(key.address);
        if (balance <= FEE_RESERVE) continue;
        await this.send(key, [transferInstruction(key, this.funder.address, balance - 5_000n)]);
      } catch (error) {
        console.warn(`[qa] sweep of ${key.address} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async devnetFunder(need: bigint): Promise<KeyPairSigner> {
    if (this.funder === null) {
      const path = QA.funderKeyPath;
      if (existsSync(path)) {
        const bytes = JSON.parse(readFileSync(path, 'utf8')) as number[];
        this.funder = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
      } else if (process.env['QA_FUNDER_KEY'] === undefined) {
        // First run on this machine: the same funder file scripts/dev-accounts creates, filled by airdrop below.
        this.funder = (await loadOrCreateKey('devnet-funder')).signer;
        console.log(`[qa] created the devnet funder ${this.funder.address} (${path})`);
      } else {
        throw new Error(`QA_FUNDER_KEY points at ${path}, which does not exist`);
      }
    }
    const balance = await this.balance(this.funder.address);
    if (balance < need) {
      for (const sol of [1n, 1n, 1n]) {
        try {
          const signature = await this.rpc<Signature>('requestAirdrop', [this.funder.address, Number(sol * LAMPORTS_PER_SOL)]);
          await this.confirm(signature);
          if ((await this.balance(this.funder.address)) >= need) return this.funder;
        } catch {
          // the faucet is rate-limited: try again, then give up below
        }
      }
      throw new Error(
        `The devnet funder ${this.funder.address} holds ${formatSol(balance)} SOL and needs ${formatSol(need)}; the airdrop ` +
          'was refused. Send it devnet SOL from https://faucet.solana.com and run again (one full run spends about 0.1 SOL).',
      );
    }
    return this.funder;
  }

  // ---- Stake accounts ----

  /**
   * A new stake account with staker = withdrawer = `owner` and no lock, `sol` SOL on top of the rent reserve.
   * `owner` pays (SystemProgram.CreateAccount + Stake.Initialize), exactly as a wallet would create one.
   */
  async createStake(owner: KeyPairSigner, sol = QA.target === 'dev' ? 0.001 : 0.02): Promise<Address> {
    const stake = await generateKeyPairSigner();
    const rent = BigInt(await this.rpc<number>('getMinimumBalanceForRentExemption', [STAKE_ACCOUNT_SIZE]));
    await this.send(owner, [
      createAccountInstruction(owner, stake, rent + BigInt(Math.round(sol * 1e9)), STAKE_ACCOUNT_SIZE, STAKE_PROGRAM_ADDRESS),
      initializeStakeInstruction(stake.address, owner.address, owner.address),
    ]);
    return stake.address;
  }

  /** Delegates `stake` (staker = `owner`) to a validator: on devnet the top vote account, locally the chain's own. */
  async delegate(owner: KeyPairSigner, stake: Address): Promise<void> {
    const voteAccount = await this.voteAccount();
    const { blockhash, lastValidBlockHeight } = await this.latestBlockhash();
    const built = buildTransaction(
      { kind: 'delegate', stakeAccount: stake, staker: owner.address, voteAccount },
      { feePayer: owner.address, lifetime: { kind: 'blockhash', blockhash, lastValidBlockHeight } },
    );
    const signed = await partiallySignTransaction([owner.keyPair], getTransactionDecoder().decode(built.bytes));
    await this.sendWire(getBase64EncodedWireTransaction(signed));
  }

  /**
   * Setup shortcut for scenarios that start from a protected account: the same SetLockupChecked the site builds
   * (core buildTransaction), signed here by both test keys. The protect flow itself is tested through the UI.
   */
  async protect(main: KeyPairSigner, second: KeyPairSigner, stake: Address, seconds: number): Promise<bigint> {
    const lockUntil = BigInt(Math.floor(Date.now() / 1000) + seconds);
    const { blockhash, lastValidBlockHeight } = await this.latestBlockhash();
    const built = buildTransaction(
      { kind: 'protect', stakeAccount: stake, mainKey: main.address, secondKey: second.address, lockUntil },
      { feePayer: main.address, lifetime: { kind: 'blockhash', blockhash, lastValidBlockHeight } },
    );
    const signed = await partiallySignTransaction([main.keyPair, second.keyPair], getTransactionDecoder().decode(built.bytes));
    await this.sendWire(getBase64EncodedWireTransaction(signed));
    return lockUntil;
  }

  private async voteAccount(): Promise<Address> {
    if (this.target === 'local') return address((await this.control<{ address: string }>('vote-account')).address);
    const { current } = await this.rpc<{ current: { votePubkey: string; activatedStake: number }[] }>('getVoteAccounts', [
      { commitment: 'confirmed' },
    ]);
    const best = [...current].sort((a, b) => b.activatedStake - a.activatedStake)[0];
    if (best === undefined) throw new Error('No active vote account on devnet');
    return address(best.votePubkey);
  }

  // ---- Local chain controls ----

  /** POST /qa/<name> on the local chain. Throws on the dev target: a real cluster has no such thing. */
  async control<T = unknown>(name: string, body: Record<string, unknown> = {}): Promise<T> {
    if (this.target !== 'local') throw new Error(`/qa/${name} exists only on the local chain`);
    const response = await fetch(`${this.rpcUrl}/qa/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`/qa/${name}: HTTP ${String(response.status)} ${await response.text()}`);
    return (await response.json()) as T;
  }

  async warpEpoch(): Promise<void> {
    await this.control('warp-epoch');
  }

  // ---- Sending ----

  async latestBlockhash(): Promise<{ blockhash: Blockhash; lastValidBlockHeight: bigint }> {
    const { value } = await this.rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [
      { commitment: 'confirmed' },
    ]);
    return { blockhash: value.blockhash as Blockhash, lastValidBlockHeight: BigInt(value.lastValidBlockHeight) };
  }

  /** Signs with the signers embedded in `instructions` and `payer`, sends, waits for confirmation; throws on failure. */
  async send(payer: TransactionSigner, instructions: Instruction[]): Promise<Signature> {
    const lifetime = await this.latestBlockhash();
    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    return this.sendWire(getBase64EncodedWireTransaction(signed));
  }

  private async sendWire(base64: string): Promise<Signature> {
    const signature = await this.rpc<Signature>('sendTransaction', [base64, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    await this.confirm(signature);
    return signature;
  }

  async confirm(signature: Signature, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { value } = await this.rpc<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>('getSignatureStatuses', [
        [signature],
      ]);
      const status = value[0];
      if (status !== null && status !== undefined) {
        if (status.err !== null) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return;
      }
      await new Promise((resolve) => setTimeout(resolve, this.target === 'local' ? 100 : 1500));
    }
    throw new Error(`Transaction ${signature} not confirmed within ${String(timeoutMs / 1000)} s`);
  }
}

// ---- Hand-built instructions (System program and Stake Initialize; apps/web carries no program clients) ----

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function concat(...parts: ArrayLike<number>[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => Array.from(part)));
}

const addressBytes = (value: Address) => getAddressEncoder().encode(value);

function signerMeta(signer: TransactionSigner) {
  return { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer } as const;
}

export function transferInstruction(from: TransactionSigner, to: Address, lamports: bigint): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [signerMeta(from), { address: to, role: AccountRole.WRITABLE }],
    data: concat(u32(2), u64(lamports)),
  };
}

function createAccountInstruction(
  payer: TransactionSigner,
  account: TransactionSigner,
  lamports: bigint,
  space: number,
  owner: Address,
): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [signerMeta(payer), signerMeta(account)],
    data: concat(u32(0), u64(lamports), u64(BigInt(space)), addressBytes(owner)),
  };
}

/** StakeInstruction::Initialize(Authorized { staker, withdrawer }, Lockup::default()). */
function initializeStakeInstruction(stake: Address, staker: Address, withdrawer: Address): Instruction {
  return {
    programAddress: STAKE_PROGRAM_ADDRESS,
    accounts: [
      { address: stake, role: AccountRole.WRITABLE },
      { address: SYSVAR_RENT, role: AccountRole.READONLY },
    ],
    data: concat(u32(0), addressBytes(staker), addressBytes(withdrawer), u64(0n), u64(0n), new Uint8Array(32)),
  };
}

export function formatSol(lamports: bigint): string {
  return (Number(lamports) / 1e9).toFixed(4);
}

