import { formatUtcDate, type ErrorCode, type FriendlyError } from '@stakeward/core';
import { t, type MessageKey } from './index.ts';

/**
 * The on-screen text for an error translated by core's `translateError` (UX rule 8). Every core ErrorCode needs an
 * `errors.<code>` entry in en.json: the template-literal key below fails to compile when one is missing.
 * The raw text (`error.detail`) belongs under "Details", not here.
 */
export function errorMessage(error: Pick<FriendlyError, 'code'>, lockUntil?: bigint): string {
  if (error.code === 'lockup-in-force') {
    const date = lockUntil !== undefined && lockUntil > 0n ? formatUtcDate(lockUntil) : null;
    return date === null ? t('errors.lockup-in-force-no-date') : t('errors.lockup-in-force', { date });
  }
  const key: `errors.${ErrorCode}` & MessageKey = `errors.${error.code}`;
  return t(key);
}
