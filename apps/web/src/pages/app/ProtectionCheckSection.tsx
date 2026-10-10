import type { Address } from '@solana/kit';
import { aiPrompt, formatSol, setupCheck, type ClockView, type KitCheckState, type SetupCheck, type StakeAccount } from '@stakeward/core';
import { useMemo } from 'react';
import { telegramLinkPath } from '@/api/telegram';
import { AskAi } from '@/components/product/ask-ai';
import {
  ProtectionCheck,
  setupCheckReason,
  setupCheckSentence,
  setupCheckStatusLabel,
  setupCheckTitle,
  type ProtectionCheckLinks,
} from '@/components/product/protection-check';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { useKnownSecondKeys, useRescueKits } from '@/ports';
import { appLinks } from './view.ts';

/**
 * At most this many one-tap rescue kits are looked up per check: GET /api/rescue-kits shares the lookup limit of 20 a
 * minute per IP with the accounts search. The kits of further locked accounts stay "unknown".
 */
export const MAX_KIT_LOOKUPS = 5;

/**
 * The "Protection check" of /app (DECISIONS.md D125) for the main key on view, and an "Ask your AI" block with its
 * result (D122). Core `setupCheck` decides every result from the accounts the page already read, the second keys this
 * browser knows and the worker's rescue kits; the AI only explains.
 */
export function ProtectionCheckSection({
  address,
  accounts,
  clock,
}: {
  address: Address;
  accounts: readonly StakeAccount[];
  clock: ClockView;
}) {
  const knownSecondKeys = useKnownSecondKeys();
  const kitsPort = useRescueKits();

  // The locked accounts whose kit to read: those core lists under the kit check before any kit is known.
  const kitAccounts = useMemo(() => {
    const before = setupCheck({ mainKey: address, accounts, clock, knownSecondKeys: [], rescueKits: {} });
    const kit = before.items.find((item) => item.id === 'rescue-kit');
    return (kit?.findings ?? []).map((finding) => finding.account).slice(0, MAX_KIT_LOOKUPS);
  }, [address, accounts, clock]);

  // A kit that cannot be read is `unknown` for its account; the check never fails the page.
  const kits = useLoad(kitAccounts.length === 0 ? null : kitAccounts.join(','), async () => {
    const answers = await Promise.allSettled(kitAccounts.map((account) => kitsPort.status(account)));
    const states: Partial<Record<Address, KitCheckState>> = {};
    answers.forEach((answer, index) => {
      const account = kitAccounts[index];
      if (account === undefined) return;
      states[account] = answer.status === 'rejected' ? 'unknown' : answer.value.status === 'ready' ? 'ready' : 'missing';
    });
    return states;
  });

  const result = useMemo(
    () =>
      setupCheck({
        mainKey: address,
        accounts,
        clock,
        knownSecondKeys,
        rescueKits: kits.status === 'ready' ? kits.value : {},
      }),
    [address, accounts, clock, knownSecondKeys, kits],
  );

  const links: ProtectionCheckLinks = {
    protect: appLinks.protect,
    extend: appLinks.extend,
    rescue: appLinks.rescue(address),
    rescueKit: '/rescue-kit',
    telegram: telegramLinkPath(address),
    recovery: appLinks.recovery,
  };

  if (kits.status === 'loading') return <ProtectionCheck state="loading" />;
  return (
    <>
      <ProtectionCheck state="ready" result={result} links={links} />
      {result.accountCount === 0 ? null : <AskAi prompt={setupCheckPrompt(result)} />}
    </>
  );
}

/** The AI question: the task, then each check and its result as facts (public data only). */
export function setupCheckPrompt(result: SetupCheck): string {
  const facts: [string, string][] = [
    [t('setupCheck.ai.accounts'), String(result.accountCount)],
    [t('setupCheck.ai.sol'), formatSol(result.lamports)],
    [t('setupCheck.ai.locked'), `${String(result.lockedCount)} (${formatSol(result.lockedLamports)})`],
    [t('setupCheck.ai.score'), result.total === 0 ? t('setupCheck.scoreNone') : t('setupCheck.score', { passed: result.passed, total: result.total })],
  ];
  for (const item of result.items) {
    const optional = item.optional ? ` (${t('setupCheck.ai.optional')})` : '';
    facts.push([t('setupCheck.ai.check', { title: setupCheckTitle(item) }), `${setupCheckStatusLabel(item)}${optional}. ${setupCheckSentence(item)}`]);
    for (const finding of item.findings) {
      facts.push([`  ${t('setupCheck.ai.account', { address: finding.account })}`, setupCheckReason(finding, result.lockEnds[finding.account])]);
    }
  }
  return aiPrompt({ task: t('setupCheck.ai.task'), facts });
}
