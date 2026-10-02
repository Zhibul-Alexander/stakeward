// Mainnet stake accounts saved as raw getAccountInfo responses (2026-10-02, epoch 1047). See fixtures/accounts/index.json.
import { address, getBase64Encoder } from '@solana/kit';
import type { RawAccount } from '../src/index.ts';
import deactivating from './fixtures/accounts/deactivating.json' with { type: 'json' };
import custodianIsWithdrawer from './fixtures/accounts/delegated-custodian-eq-withdrawer.json' with { type: 'json' };
import delegatedLockup from './fixtures/accounts/delegated-lockup.json' with { type: 'json' };
import delegatedNoLockup from './fixtures/accounts/delegated-no-lockup.json' with { type: 'json' };
import stakerIsNotWithdrawer from './fixtures/accounts/delegated-staker-ne-withdrawer.json' with { type: 'json' };
import initializedLockup from './fixtures/accounts/initialized-lockup.json' with { type: 'json' };
import initialized from './fixtures/accounts/initialized.json' with { type: 'json' };

export type Fixture = {
  address: string;
  response: { result: { value: { data: string[]; lamports: number; owner: string } } };
};

export const FIXTURES = {
  deactivating,
  custodianIsWithdrawer,
  delegatedLockup,
  delegatedNoLockup,
  stakerIsNotWithdrawer,
  initializedLockup,
  initialized,
} satisfies Record<string, Fixture>;

export function rawFromFixture(fixture: Fixture): RawAccount {
  const { value } = fixture.response.result;
  const base64 = value.data[0];
  if (base64 === undefined) throw new Error('fixture without data');
  return {
    address: address(fixture.address),
    data: getBase64Encoder().encode(base64),
    lamports: BigInt(value.lamports),
    owner: address(value.owner),
  };
}
