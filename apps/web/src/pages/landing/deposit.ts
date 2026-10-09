import { formatSol, NONCE_ACCOUNT_SIZE } from '@stakeward/core';
import { useLoad, type Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { useChain } from '@/ports';

/**
 * The deposit a link-signing account (durable nonce) holds, read from the network: rent for NONCE_ACCOUNT_SIZE bytes
 * (DECISIONS.md D22; rent has changed before, so no constant). One /api/rpc call per view of the landing page.
 */
export function useNonceDeposit(): Load<bigint> {
  const chain = useChain();
  return useLoad('nonce-deposit', () => chain.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_SIZE));
}

/** The deposit inside a sentence: the amount once read, else neutral words (no error box, spec L9). */
export function depositText(deposit: Load<bigint>): string {
  return deposit.status === 'ready' ? formatSol(deposit.value) : t('landing.fees.depositFallback');
}
