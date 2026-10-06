import { formatUtcDateTime } from '@stakeward/core';
import { t } from '@/i18n';

/**
 * Protect and extend compute the lock end from the cluster clock, which reaches the browser through the worker's RPC
 * proxy (CLAUDE.md section 3). A lying worker or RPC could answer with a Clock from 2099 and the wizard would offer a
 * lock until 2099 (SECURITY-CHECK П12). So both refuse to go on when the cluster clock and this device's clock differ
 * by more than this: a day is far beyond the cluster's drift and a device's normal error.
 */
export const MAX_CLOCK_SKEW_SECONDS = 86_400n;

/** The two clocks (unix seconds) when they differ by more than MAX_CLOCK_SKEW_SECONDS. */
export type ClockSkew = { network: bigint; device: bigint };

/** Null when the network clock is within a day of the device clock; else both readings. */
export function clockSkew(network: bigint, device: bigint): ClockSkew | null {
  const difference = network > device ? network - device : device - network;
  return difference > MAX_CLOCK_SKEW_SECONDS ? { network, device } : null;
}

/** The readings for "Details" (UX rule 8): dates, unix seconds, the difference and the limit. */
export function clockSkewDetail({ network, device }: ClockSkew): string {
  const difference = network > device ? network - device : device - network;
  return t('protect.clockSkew.detail', {
    networkTime: formatUtcDateTime(network) ?? '-',
    networkUnix: network.toString(),
    deviceTime: formatUtcDateTime(device) ?? '-',
    deviceUnix: device.toString(),
    difference: difference.toString(),
    allowed: MAX_CLOCK_SKEW_SECONDS.toString(),
  });
}
