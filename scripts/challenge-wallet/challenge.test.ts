// scripts/challenge-wallet.ts on LiteSVM with the mainnet stake program: the published main key alone cannot take
// the SOL, unlock the account or hand it to another wallet; it can deactivate it.
import { createKeyPairSignerFromBytes, generateKeyPairSigner, getBase58Encoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { createLiteSvmChain } from '../gate/litesvm.ts';
import { createSender } from '../gate/sender.ts';
import { LAMPORTS_PER_SOL } from '../gate/tx.ts';
import { base58SecretKey, CHALLENGE_LOCK_UNTIL, createChallenge, renderChallenge } from './challenge.ts';

describe('challenge wallet on LiteSVM', () => {
  it('locks a delegated account until 2099 with the second key, and the main key alone cannot withdraw', async () => {
    const chain = await createLiteSvmChain();
    const [funder, main, second] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
    chain.fund(funder.address, 2n * LAMPORTS_PER_SOL);

    const challenge = await createChallenge(chain, { funder, main, second }, { stakeLamports: LAMPORTS_PER_SOL, runId: 't' });
    expect(new Date(Number(CHALLENGE_LOCK_UNTIL) * 1000).toISOString()).toBe('2099-12-31T00:00:00.000Z');
    expect(challenge.state).toMatchObject({
      kind: 'delegated',
      staker: main.address,
      withdrawer: main.address,
      lockup: { unixTimestamp: CHALLENGE_LOCK_UNTIL, epoch: 0n, custodian: second.address },
    });

    // The thief holds the main key and pays their own fees.
    chain.fund(main.address, LAMPORTS_PER_SOL);
    const sender = createSender(chain, new Map(), () => undefined);
    const stakeAccount = challenge.stakeAccount;
    const withdraw = await sender.send(
      'thief withdraws',
      sender.product(
        { kind: 'withdraw', stakeAccount, mainKey: main.address, secondKey: null, recipient: main.address, lamports: challenge.state.lamports },
        [main],
      ),
    );
    expect(withdraw.outcome).toMatchObject({ status: 'failed', error: { kind: 'custom', code: 1 } }); // LockupInForce
    const unlock = await sender.send(
      'thief unlocks',
      sender.product({ kind: 'unlock', stakeAccount, secondKey: main.address }, [main], main.address),
    );
    expect(unlock.outcome).toMatchObject({ status: 'failed', error: { name: 'MissingRequiredSignature' } });
    const deactivate = await sender.send(
      'thief deactivates',
      sender.product({ kind: 'deactivate', stakeAccount, staker: main.address }, [main]),
    );
    expect(deactivate.outcome.status).toBe('ok');
  });

  it('prints the main key in the base58 form wallets import, and only the file path of the second key', async () => {
    const seedAndPublic = new Uint8Array(64);
    const signer = await generateKeyPairSigner(true);
    const seed = new Uint8Array(await crypto.subtle.exportKey('pkcs8', signer.keyPair.privateKey)).slice(-32);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', signer.keyPair.publicKey));
    seedAndPublic.set(seed);
    seedAndPublic.set(publicKey, 32);
    const secret = base58SecretKey(seedAndPublic);
    const restored = await createKeyPairSignerFromBytes(new Uint8Array(getBase58Encoder().encode(secret)));
    expect(restored.address).toBe(signer.address);

    const second = await generateKeyPairSigner();
    const printed = renderChallenge(
      { stakeAccount: second.address, setup: 's' as never, protect: 'p' as never, state: { lamports: 1n } as never },
      { address: signer.address, secretKey: secret },
      { address: second.address, keyFile: '.keys/challenge-second.json' },
    ).join('\n');
    expect(printed).toContain(secret);
    expect(printed).toContain('.keys/challenge-second.json');
    expect(printed).toContain(`/proof/${signer.address}`);
  });

  it('locks an undelegated account below the minimum delegation with --undelegated', async () => {
    const chain = await createLiteSvmChain();
    const [funder, main, second] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
    chain.fund(funder.address, LAMPORTS_PER_SOL);
    const challenge = await createChallenge(
      chain,
      { funder, main, second },
      { stakeLamports: LAMPORTS_PER_SOL / 10n, runId: 'u', undelegated: true },
    );
    expect(challenge.state).toMatchObject({
      kind: 'initialized',
      delegation: null,
      lockup: { unixTimestamp: CHALLENGE_LOCK_UNTIL, custodian: second.address },
    });
  });
});
