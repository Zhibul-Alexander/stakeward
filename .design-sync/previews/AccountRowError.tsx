import { AccountList, AccountListItem, AccountRowError } from '@stakeward/design-system';
import { SAMPLE, SAMPLE_ERROR_DETAIL } from '../../apps/web/src/pages/dev-ui/samples';

const noop = () => undefined;

/**
 * The row's error state, a DS state no product screen renders (a failed read there is one ErrorState for the whole
 * list): what happened, the account's address, Try again, and the raw error under Details.
 */
export const WithRetry = () => (
  <AccountList label="Stake accounts">
    <AccountListItem>
      <AccountRowError address={SAMPLE.stakeB} detail={SAMPLE_ERROR_DETAIL.rpc} onRetry={noop} />
    </AccountListItem>
  </AccountList>
);
