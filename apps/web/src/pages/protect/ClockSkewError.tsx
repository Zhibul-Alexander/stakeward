import { ErrorState } from '@/components/product/error-state';
import { formatDateTime, t } from '@/i18n';
import { clockSkewDetail, type ClockSkew } from './clock.ts';

/**
 * Protect and extend stop here when the cluster clock is more than a day off this device's clock (SECURITY-CHECK
 * П12): what happened and what to do, both readings under Details, and Try again (it reads the network again).
 */
export function ClockSkewError({ skew, onRetry }: { skew: ClockSkew; onRetry: () => void }) {
  return (
    <ErrorState
      title={t('protect.clockSkew.title')}
      message={t('protect.clockSkew.body', {
        network: formatDateTime(skew.network) ?? skew.network.toString(),
        device: formatDateTime(skew.device) ?? skew.device.toString(),
      })}
      detail={clockSkewDetail(skew)}
      onRetry={onRetry}
    />
  );
}
