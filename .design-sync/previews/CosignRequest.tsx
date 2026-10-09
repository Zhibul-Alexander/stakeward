import { CosignRequest } from '@stakeward/design-system';
import { SAMPLE } from '../../apps/web/src/pages/dev-ui/samples';

// The lock ends on 10 April 2027; the stake account holds 1,250.5 SOL.

/** A protect link: the Second key learns, with the date, what it takes on. */
export const BecomeSecondKey = () => (
  <CosignRequest
    kind="protect"
    from="main"
    ask="Become the Second key for this stake until 10 April 2027"
    lines={[
      'Until then, the owner needs your signature to withdraw or move this stake.',
      'If you lose this wallet, the owner waits until 10 April 2027.',
      'Your wallet cannot take their SOL.',
    ]}
    meta="This stake account holds 1,250.5 SOL."
  />
);

/** A withdrawal link: the one address to check is the Main key the SOL goes to. */
export const ApproveWithdrawal = () => (
  <CosignRequest
    kind="withdraw"
    from="main"
    ask="Approve a withdrawal of 1,250.5 SOL to the Main key"
    check={{
      title: 'Check before you sign',
      lines: [
        'A thief with the Main key would send exactly this request.',
        'Sign only if you started it, or the owner confirmed it by voice or in person.',
      ],
      role: 'main',
      address: SAMPLE.mainKey,
    }}
  />
);

/** A rescue link sent by the New wallet: check its address with the owner by voice before signing. */
export const ApproveRescue = () => (
  <CosignRequest
    kind="rescue"
    from="new"
    ask="Approve moving this stake to a New wallet"
    check={{
      title: 'Check this address before you sign',
      lines: [
        'A thief with the Main key would send exactly this, with their own wallet.',
        'Check the address with the owner by voice or in person, not in the chat that sent this link.',
      ],
      role: 'new',
      address: SAMPLE.newWallet,
    }}
  />
);
