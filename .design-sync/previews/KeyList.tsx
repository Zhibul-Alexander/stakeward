import { KeyList } from '@stakeward/design-system';
import { SAMPLE } from '../../apps/web/src/pages/dev-ui/samples';

/** Withdraw while the lock holds: the Main key receives and pays, the Second key co-signs (the lock's date is on the row above). */
export const WithdrawWithBothKeys = () => (
  <KeyList
    items={[
      { role: 'main', address: SAMPLE.mainKey, note: 'Receives the SOL and pays the network fee' },
      { role: 'second', address: SAMPLE.secondKey, note: 'Co-signs this withdrawal' },
    ]}
  />
);

/** The lock ended: the Main key signs alone, said in a second line. */
export const MainKeyAlone = () => (
  <KeyList
    items={[
      {
        role: 'main',
        address: SAMPLE.mainKey,
        note: (
          <>
            <span>Receives the SOL and pays the network fee</span>
            <span>Lock ended on 1 October 2026, so your main key signs alone.</span>
          </>
        ),
      },
    ]}
  />
);

/** Stop staking first (Deactivate): one key, the Main key, signs alone. */
export const StopStaking = () => <KeyList items={[{ role: 'main', address: SAMPLE.mainKey, note: 'Signs alone' }]} />;
