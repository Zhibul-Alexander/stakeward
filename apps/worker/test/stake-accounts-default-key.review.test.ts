// Review (step 3, /api/stake-accounts): the all-zero address 11111111111111111111111111111111 (Pubkey::default, the
// System program id) passes the address check. As `custodian=` it asks the upstream for every stake account WITHOUT a
// lock: lockup.custodian is all zeros on nearly every stake account on mainnet. One request per IP every 3 s (20/60 s)
// makes the worker request and parse a getProgramAccounts answer of hundreds of thousands of 200-byte accounts:
// Helius credits, the 128 MB isolate memory and the CPU limit go first. The site itself sends this query for
// /app?address=11111111111111111111111111111111 (AccountsResults reads by custodian too).
import { describe, expect, it } from 'vitest';
import { fakeUpstream, freshIp, testApp } from './fakes.ts';

describe('review: GET /api/stake-accounts with the all-zero address', () => {
  it.each(['custodian', 'withdrawer'])('refuses %s=11111111111111111111111111111111 without asking upstream', async (role) => {
    const upstream = fakeUpstream(() => {
      throw new Error('unexpected upstream call');
    });
    const res = await testApp(upstream).request(`/api/stake-accounts?${role}=11111111111111111111111111111111`, {
      headers: { 'CF-Connecting-IP': freshIp() },
    });
    expect(upstream.calls).toHaveLength(0);
    expect(res.status).toBe(400);
  });
});
