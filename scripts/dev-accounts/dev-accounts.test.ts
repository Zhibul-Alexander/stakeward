// scripts/dev-accounts.ts on LiteSVM with the mainnet stake program: the same plan and setup transactions the devnet
// run sends, then the product's own transactions prove that the target wallet controls the accounts.
import { generateKeyPairSigner, getProgramDerivedAddress, type Address } from '@solana/kit';
import {
  decodeStakeAccount,
  STAKE_PROGRAM_ADDRESS,
  U64_MAX,
  ZERO_ADDRESS,
  type StakeAccount,
} from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { MIN_DELEGATION_LAMPORTS } from '../gate/budget.ts';
import { createLiteSvmChain, type LiteSvmGateChain } from '../gate/litesvm.ts';
import { createSender } from '../gate/sender.ts';
import { LAMPORTS_PER_SOL, transactionFee } from '../gate/tx.ts';
import {
  createDevAccounts,
  DevAccountsRefusal,
  explorerUrl,
  planDevAccounts,
  renderCreated,
  renderPlan,
  type DevAccountsOptions,
} from './accounts.ts';
import { parseDevAccountsArgs, parseSol, UsageError } from './args.ts';

/** Rent-exempt minimums on devnet (DECISIONS.md D22); the LiteSVM harness charges the same. */
const STAKE_RENT = 1_666_240n;
const WALLET_RENT = 650_240n;

async function setup() {
  const chain = await createLiteSvmChain();
  const funder = await generateKeyPairSigner();
  const target = await generateKeyPairSigner();
  return { chain, funder, target };
}

function options(target: Address, overrides: Partial<DevAccountsOptions> = {}): DevAccountsOptions {
  return {
    target,
    kinds: ['delegated', 'undelegated'],
    delegatedLamports: LAMPORTS_PER_SOL,
    undelegatedLamports: LAMPORTS_PER_SOL / 10n,
    runId: 'test',
    ...overrides,
  };
}

async function readStake(chain: LiteSvmGateChain, address: Address): Promise<StakeAccount> {
  const raw = await chain.account(address);
  if (raw === null) throw new Error(`${address} does not exist`);
  const decoded = decodeStakeAccount(raw);
  if (!decoded.ok) throw new Error(`${address}: ${decoded.error}`);
  return decoded.account;
}

describe('dev-accounts on LiteSVM', () => {
  it('creates a delegated and an undelegated account with staker = withdrawer = target and no lockup', async () => {
    const { chain, funder, target } = await setup();
    const plan = await planDevAccounts(chain, funder.address, options(target.address));
    const vote = await chain.voteAccount();
    expect(plan.voteAccount).toBe(vote);
    expect(plan.accounts.map((a) => [a.kind, a.lamports])).toEqual([
      ['delegated', STAKE_RENT + LAMPORTS_PER_SOL],
      ['undelegated', STAKE_RENT + LAMPORTS_PER_SOL / 10n],
    ]);
    expect(plan.fees).toBe(2n * transactionFee(1));
    expect(plan.cost).toBe(2n * STAKE_RENT + 1_100_000_000n + plan.fees);
    expect(plan.required).toBe(plan.cost + WALLET_RENT);

    // Exactly the amount the script asks for is enough.
    chain.fund(funder.address, plan.required);
    const { accounts, fees } = await createDevAccounts(chain, funder, { ...plan, balance: plan.required });
    expect(fees).toBe(plan.fees);
    expect(chain.testChain.balance(funder.address)).toBe(WALLET_RENT);

    const [delegatedPlan, undelegatedPlan] = plan.accounts;
    if (delegatedPlan === undefined || undelegatedPlan === undefined) throw new Error('two accounts planned');
    const epoch = (await chain.clock()).epoch;
    const noLockup = { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS };

    const delegated = await readStake(chain, delegatedPlan.address);
    expect(delegated).toMatchObject({
      kind: 'delegated',
      staker: target.address,
      withdrawer: target.address,
      lockup: noLockup,
      lamports: STAKE_RENT + LAMPORTS_PER_SOL,
    });
    expect(delegated.delegation).toEqual({
      voter: vote,
      stake: LAMPORTS_PER_SOL,
      activationEpoch: epoch,
      deactivationEpoch: U64_MAX,
    });

    const undelegated = await readStake(chain, undelegatedPlan.address);
    expect(undelegated).toMatchObject({
      kind: 'initialized',
      staker: target.address,
      withdrawer: target.address,
      lockup: noLockup,
      lamports: STAKE_RENT + LAMPORTS_PER_SOL / 10n,
      delegation: null,
    });
    expect(accounts.map((a) => a.state)).toEqual([delegated, undelegated]);

    const printed = renderCreated(plan, accounts, fees).join('\n');
    expect(printed).toContain(explorerUrl('address', delegatedPlan.address));
    expect(printed).toContain(explorerUrl('address', undelegatedPlan.address));
    expect(printed).toContain(explorerUrl('tx', accounts[0]?.signature ?? ''));
    expect(printed).toContain('Total cost 1.10334368 SOL');

    // The target wallet controls both accounts through the product's own transactions; the funder controls neither.
    const sender = createSender(chain, new Map(), () => undefined);
    chain.fund(target.address, LAMPORTS_PER_SOL);
    chain.fund(funder.address, LAMPORTS_PER_SOL); // it kept only its rent reserve, too little for a fee
    const asFunder = await sender.send(
      'funder deactivates',
      sender.product({ kind: 'deactivate', stakeAccount: delegatedPlan.address, staker: funder.address }, [funder]),
    );
    expect(asFunder.outcome).toMatchObject({ status: 'failed', error: { name: 'MissingRequiredSignature' } });
    const deactivate = await sender.send(
      'target deactivates',
      sender.product({ kind: 'deactivate', stakeAccount: delegatedPlan.address, staker: target.address }, [target]),
    );
    expect(deactivate.outcome.status).toBe('ok');
    const withdraw = {
      kind: 'withdraw',
      stakeAccount: undelegatedPlan.address,
      mainKey: target.address,
      secondKey: null,
      recipient: target.address,
      lamports: undelegated.lamports,
    } as const;
    expect((await sender.send('target withdraws', sender.product(withdraw, [target]))).outcome.status).toBe('ok');
    expect(await chain.account(undelegatedPlan.address)).toBeNull();
  });

  it('creates only the undelegated account with --only, without looking up a validator', async () => {
    const { chain, funder, target } = await setup();
    const plan = await planDevAccounts(
      chain,
      funder.address,
      options(target.address, { kinds: ['undelegated'], undelegatedLamports: 0n }),
    );
    expect(plan.voteAccount).toBeNull();
    expect(plan.accounts.map((a) => a.kind)).toEqual(['undelegated']);
    chain.fund(funder.address, plan.required);
    const { accounts } = await createDevAccounts(chain, funder, plan);
    expect(accounts[0]?.state).toMatchObject({
      kind: 'initialized',
      staker: target.address,
      withdrawer: target.address,
      lamports: STAKE_RENT,
    });
  });

  it('plans without sending and refuses to send while the funder holds less than needed', async () => {
    const { chain, funder, target } = await setup();
    const empty = await planDevAccounts(chain, funder.address, options(target.address));
    chain.fund(funder.address, empty.required - 1n);
    const plan = await planDevAccounts(chain, funder.address, options(target.address));
    expect(plan.balance).toBe(plan.required - 1n);
    const printed = renderPlan(plan, '.keys/devnet-funder.json').join('\n');
    expect(printed).toContain(plan.accounts[0]?.address);
    expect(printed).toContain('total cost   1.10334368 SOL');

    const refused = createDevAccounts(chain, funder, plan);
    await expect(refused).rejects.toThrow(DevAccountsRefusal);
    await expect(refused).rejects.toThrow(`this needs 1.10399392 SOL (${plan.required.toString()} lamports)`);
    for (const account of plan.accounts) expect(await chain.account(account.address)).toBeNull();
    expect(chain.testChain.balance(funder.address)).toBe(plan.required - 1n);
  });

  it('refuses a target that is not a wallet and a delegation below the minimum', async () => {
    const { chain, funder, target } = await setup();
    const refuse = (overrides: Partial<DevAccountsOptions>) =>
      expect(planDevAccounts(chain, funder.address, options(target.address, overrides))).rejects.toThrow(
        DevAccountsRefusal,
      );
    await refuse({ target: funder.address });
    const [pda] = await getProgramDerivedAddress({ programAddress: STAKE_PROGRAM_ADDRESS, seeds: ['x'] });
    await refuse({ target: pda });
    await refuse({ target: await chain.voteAccount() }); // an account of the vote program
    await refuse({ delegatedLamports: MIN_DELEGATION_LAMPORTS - 1n });
    await refuse({ kinds: [] });
    // Below the minimum is fine when only the undelegated account is created.
    await expect(
      planDevAccounts(chain, funder.address, options(target.address, { kinds: ['undelegated'], delegatedLamports: 0n })),
    ).resolves.toMatchObject({ voteAccount: null });
  });
});

describe('dev-accounts command line', () => {
  const ADDRESS = '63rAwzgKQ7P5CSHVtQi6Gasu3wVKhChmzxA2H2A5ssRD';

  it('defaults to both accounts, 1 SOL of stake and 0.1 SOL spare', () => {
    expect(parseDevAccountsArgs([ADDRESS])).toEqual({
      help: false,
      target: ADDRESS,
      kinds: ['delegated', 'undelegated'],
      delegatedLamports: 1_000_000_000n,
      undelegatedLamports: 100_000_000n,
      dryRun: false,
    });
  });

  it('reads the flags, also after a pnpm `--` separator', () => {
    expect(
      parseDevAccountsArgs(['--', ADDRESS, '--delegated-sol', '2.5', '--undelegated-sol=0', '--only', 'delegated', '--dry-run']),
    ).toEqual({
      help: false,
      target: ADDRESS,
      kinds: ['delegated'],
      delegatedLamports: 2_500_000_000n,
      undelegatedLamports: 0n,
      dryRun: true,
    });
    expect(parseDevAccountsArgs(['--help'])).toEqual({ help: true });
  });

  it.each([
    [[]],
    [[ADDRESS, ADDRESS]],
    [['not-an-address']],
    [[ADDRESS, '--only', 'both']],
    [[ADDRESS, '--delegated-sol', '-1']],
    [[ADDRESS, '--yes']],
  ])('rejects %j', (argv) => {
    expect(() => parseDevAccountsArgs(argv)).toThrow(UsageError);
  });

  it('parses SOL amounts exactly, up to 9 decimals', () => {
    expect(parseSol('1', 'x')).toBe(1_000_000_000n);
    expect(parseSol('0.1', 'x')).toBe(100_000_000n);
    expect(parseSol('1.000000001', 'x')).toBe(1_000_000_001n);
    for (const bad of ['', '.5', '1.', '1.0000000001', '1e3', '1,5', ' 1']) {
      expect(() => parseSol(bad, 'x')).toThrow(UsageError);
    }
  });
});
