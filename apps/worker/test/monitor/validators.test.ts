// The daily validator check (DECISIONS.md D127): one read of the validators watched stake is delegated to, a
// VALIDATOR_AT_RISK event per delegated account for each risk a validator did not have at the last check.
import { getAddressDecoder, type Address } from '@solana/kit';
import { GENESIS_HASH } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VOTER } from './fake-chain.ts';
import { createHarness, type Harness } from './harness.ts';
import { key, LOCK_UNTIL, type StakeAccountSpec } from '../transactions.ts';

const MAIN = key(1);
const SECOND = key(2);
const SICK = key(43);
const SPEC: StakeAccountSpec = { state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: LOCK_UNTIL };
const CHAT = '500000001';

/** Watched accounts at 05:00 UTC: two delegated to SICK, one deactivating from it, one never delegated, one elsewhere. */
async function setup(): Promise<Harness> {
  const h = createHarness();
  h.at('2026-10-05T05:00:00Z');
  h.chain.putVote(SICK);
  h.chain.putStake(key(10), { ...SPEC, voter: SICK });
  h.chain.putStake(key(11), { ...SPEC, voter: SICK });
  h.chain.putStake(key(12), { ...SPEC, voter: SICK, deactivationEpoch: 950n });
  h.chain.putStake(key(13), { ...SPEC, state: 'initialized' });
  h.chain.putStake(key(14), SPEC);
  await h.seedWatched([key(10), key(11), key(12), key(13), key(14)]);
  await h.linkChat(MAIN, CHAT);
  return h;
}

const atRisk = async (h: Harness) =>
  (await h.readEvents()).filter((e) => e.type === 'VALIDATOR_AT_RISK').map((e) => [e.stake_account, e.details]);

async function storedRisks(h: Harness): Promise<Record<string, unknown>> {
  const { results } = await h.db.prepare('SELECT voter, risks FROM validators ORDER BY voter').all<{ voter: string; risks: string }>();
  return Object.fromEntries(results.map((row) => [row.voter, JSON.parse(row.risks) as unknown]));
}

describe('the validator check', () => {
  it('runs once a day from 06:00 UTC and finds nothing on healthy validators', async () => {
    const h = await setup();
    expect(await h.pass()).toMatchObject({ outcome: 'ok', validators: 0 });

    h.at('2026-10-05T06:00:00Z');
    const reads = h.chain.calls.length;
    expect(await h.pass()).toMatchObject({ outcome: 'ok', validators: 2, validatorEvents: 0 });
    const read = h.chain.callsOf('getMultipleAccounts').slice(-1)[0];
    expect(read?.keys.slice(1).sort()).toEqual([DEFAULT_VOTER, SICK].sort());
    expect(h.chain.calls.slice(reads).some((c) => c.method === 'getGenesisHash')).toBe(false);
    expect(await storedRisks(h)).toEqual({ [DEFAULT_VOTER]: [], [SICK]: [] });
    expect(JSON.parse((await h.readMeta()).validator_sweep ?? 'null')).toEqual({ day: '2026-10-05', after: '', done: true });

    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ validators: 0 });
    expect(await atRisk(h)).toEqual([]);
  });

  it('alerts each delegated account of a validator that stopped voting, once, and the main key gets it', async () => {
    const h = await setup();
    h.chain.putVote(SICK, { lastVotedEpoch: 947n });
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', validatorEvents: 2 });
    const details = { voter: SICK, risks: ['NOT_VOTING'] };
    expect(await atRisk(h)).toEqual([
      [key(10), details],
      [key(11), details],
    ]);

    const sent = h.telegram.requests.filter((r) => r.chatId === CHAT);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain(`Validator ${SICK.slice(0, 4)}...${SICK.slice(-4)}, which stake`);
    expect(sent[0]?.text).toContain('has not voted for over an epoch. This stake earns no rewards while it stays there.');
    expect(sent[0]?.button?.url).toBe(`https://stakeward.test/app?address=${MAIN}`);

    // The next day the same risk is no news.
    h.at('2026-10-06T06:00:00Z');
    expect(await h.pass()).toMatchObject({ validators: 2, validatorEvents: 0 });
    expect(await atRisk(h)).toHaveLength(2);
  });

  it('alerts again for a new risk, and for a risk that comes back after it went away', async () => {
    const h = await setup();
    h.chain.putVote(SICK, { lastVotedEpoch: 947n });
    h.at('2026-10-05T06:00:00Z');
    await h.pass();

    h.chain.putVote(SICK, { lastVotedEpoch: 947n, bls: false });
    h.at('2026-10-06T06:00:00Z');
    expect(await h.pass()).toMatchObject({ validatorEvents: 2 });
    expect((await atRisk(h)).slice(-1)).toEqual([[key(11), { voter: SICK, risks: ['NOT_VOTING', 'NO_BLS_KEY'] }]]);

    h.chain.putVote(SICK);
    h.at('2026-10-07T06:00:00Z');
    expect(await h.pass()).toMatchObject({ validatorEvents: 0 });
    expect(await storedRisks(h)).toMatchObject({ [SICK]: [] });

    h.chain.putVote(SICK, { commission: 10_000 });
    h.at('2026-10-08T06:00:00Z');
    expect(await h.pass()).toMatchObject({ validatorEvents: 2 });
    expect((await atRisk(h)).slice(-1)).toEqual([[key(11), { voter: SICK, risks: ['FULL_COMMISSION'] }]]);
  });

  it('calls a closed vote account closed only after the node proved its cluster', async () => {
    const h = await setup();
    h.chain.votes.delete(SICK);
    h.chain.genesis(GENESIS_HASH.mainnet);
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', validators: 0, validatorEvents: 0 });
    expect(await storedRisks(h)).toEqual({});
    expect((await h.readMeta()).validator_sweep).toBeUndefined();

    h.chain.genesis(GENESIS_HASH.devnet);
    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ validators: 2, validatorEvents: 2 });
    expect((await atRisk(h))[0]).toEqual([key(10), { voter: SICK, risks: ['CLOSED'] }]);
  });

  it('a failed read leaves the check for the next pass without failing this one', async () => {
    const h = await setup();
    h.at('2026-10-05T06:00:00Z');
    // The chunk read answers; the validator read after it fails all three attempts.
    let armed = false;
    h.chain.onCall((call) => {
      if (call.method !== 'getMultipleAccounts' || armed) return;
      armed = true;
      h.chain.failNext('getMultipleAccounts', [503, 503, 503]);
    });
    const report = await h.pass();
    expect(report).toMatchObject({ outcome: 'ok', validators: 0 });
    expect((await h.readMeta()).validator_sweep).toBeUndefined();
  });

  it('goes through more validators than a page holds over several passes, each once', { timeout: 30_000 }, async () => {
    const h = createHarness();
    h.at('2026-10-05T05:00:00Z');
    const stakes: Address[] = [];
    for (let i = 0; i < 101; i += 1) {
      const voter = key(100 + i);
      const bytes = new Uint8Array(32).fill(9);
      bytes[0] = i;
      const stake = getAddressDecoder().decode(bytes);
      stakes.push(stake);
      h.chain.putVote(voter, { lastVotedEpoch: 900n });
      h.chain.putStake(stake, { ...SPEC, voter });
    }
    await h.seedWatched(stakes);

    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ validators: 99, validatorEvents: 99 });
    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ validators: 2, validatorEvents: 2 });
    h.at('2026-10-05T06:04:00Z');
    expect(await h.pass()).toMatchObject({ validators: 0 });
    expect(new Set((await atRisk(h)).map(([stake]) => stake)).size).toBe(101);
  });
});
