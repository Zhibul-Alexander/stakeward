import type { Address } from '@solana/kit';
import { aiPrompt, parseAlertLink, type AlertLink } from '@stakeward/core';
import { useState } from 'react';
import { useSearch } from 'wouter';
import type { WatchedAccounts } from '@/api/accounts';
import {
  AlertExplanation,
  alertEventText,
  alertLockEndText,
  alertStatusText,
  alertTimeText,
} from '@/components/product/alert-explanation';
import { AskAi } from '@/components/product/ask-ai';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { useWatchedAccounts } from '@/ports';

/** Earlier changes shown under the alert, newest first. */
const RECENT_MAX = 5;

/**
 * "Explain this alert" (DECISIONS.md D125) on the page a Telegram alert's button opens (/app, /rescue, /extend). The
 * button's link carries `event` and `stake` (core alertLinkPath); without them this renders nothing. `wallet` is the
 * main key or second key whose watched accounts to read (GET /api/accounts); null while the page does not know it
 * (`waiting`), or when it cannot (then the block says so and offers to try again).
 */
export function AlertFromLink({ wallet, waiting = false, onRetry }: { wallet: Address | null; waiting?: boolean; onRetry?: (() => void) | undefined }) {
  const alert = parseAlertLink(useSearch());
  const load = useWatchedAccounts();
  const [attempt, setAttempt] = useState(0);
  const data = useLoad(alert === null || wallet === null ? null : `${wallet}#${String(attempt)}`, () =>
    wallet === null ? Promise.reject(new Error('No wallet')) : load(wallet),
  );
  if (alert === null) return null;

  const retry = () => {
    setAttempt((value) => value + 1);
  };
  if (wallet === null && !waiting) {
    return (
      <>
        <AlertExplanation state="error" event={alert.event} stake={alert.stake} onRetry={onRetry} />
        <AskAi prompt={alertPrompt(alert, null)} />
      </>
    );
  }
  if (data.status === 'ready') {
    return (
      <>
        <AlertExplanation state="ready" event={alert.event} stake={alert.stake} {...explained(alert, data.value)} />
        <AskAi prompt={alertPrompt(alert, data.value)} />
      </>
    );
  }
  if (data.status === 'error') {
    return (
      <>
        <AlertExplanation state="error" event={alert.event} stake={alert.stake} detail={data.error.detail} onRetry={retry} />
        <AskAi prompt={alertPrompt(alert, null)} />
      </>
    );
  }
  return <AlertExplanation state="loading" event={alert.event} stake={alert.stake} />;
}

/** This alert's time, the account as stored, and its other recent events (the worker lists them newest first). */
function explained(alert: AlertLink, data: WatchedAccounts) {
  const events = data.events.filter((event) => event.stakeAccount === alert.stake);
  const self = events.find((event) => event.type === alert.event);
  return {
    detectedAt: self?.detectedAt ?? null,
    current: data.accounts.find((account) => account.address === alert.stake) ?? null,
    recent: events.filter((event) => event !== self).slice(0, RECENT_MAX),
  };
}

/** The AI question: the task and the alert's facts (public data only). */
export function alertPrompt(alert: AlertLink, data: WatchedAccounts | null): string {
  const facts: [string, string][] = [
    [t('alertExplain.ai.event'), `${alertEventText(alert.event)} (${alert.event})`],
    [t('alertExplain.ai.account'), alert.stake],
  ];
  if (data !== null) {
    const { detectedAt, current, recent } = explained(alert, data);
    facts.push(
      [t('alertExplain.ai.time'), alertTimeText(detectedAt)],
      [t('alertExplain.ai.status'), alertStatusText(current)],
      [t('alertExplain.ai.lockEnd'), alertLockEndText(current)],
    );
    for (const event of recent) facts.push([t('alertExplain.ai.recent'), `${alertTimeText(event.detectedAt)}: ${alertEventText(event.type)}`]);
  }
  return aiPrompt({ task: t('alertExplain.ai.task'), facts });
}
