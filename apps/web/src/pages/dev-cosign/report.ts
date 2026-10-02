import type { Address, Signature } from '@solana/kit';
import { shortAddress, type Cluster, type ErrorCode, type SigningStepErrorCode, type WalletRole } from '@stakeward/core';
import { explorerUrl } from '@/config';
import { t, type Messages } from '@/i18n';
import type { StorageLike } from '@/ports';
import type { MessageChange } from './diff.ts';

/**
 * The plain-text report of one wallet-matrix run (CLAUDE.md section 10, step 3, "Проверяю я"): the owner copies it
 * after each pair and fills in what only a person can see (wallet warnings, what Ledger showed).
 */

export type SigningOrder = 'main-first' | 'second-first';
export type LifetimeChoice = 'blockhash' | 'nonce';

export type SignOutcome =
  | {
      kind: 'signed';
      change: MessageChange;
      check: { ok: true; lighthouseInstructions: number } | { ok: false; code: SigningStepErrorCode; message: string };
    }
  /** The wallet refused, failed, or the user stopped waiting (`code`: translateError code, port error name or `cancelled`). */
  | { kind: 'wallet-error'; code: string; message: string; detail: string }
  | { kind: 'not-reached' };

export type SignerRecord = {
  role: WalletRole;
  walletName: string;
  /** Wallet Standard `wallet.version` (the standard's version, not the app's); null for other wallets. */
  walletVersion: string | null;
  /** How many accounts the wallet offered to the site when it was asked to sign. */
  accountsOffered: number;
  address: Address;
  outcome: SignOutcome;
};

export type VerifyOutcome = { ok: true } | { ok: false; code: string; message: string };

export type SendOutcome =
  | { kind: 'confirmed'; signature: Signature }
  | { kind: 'failed'; signature: Signature | null; code: ErrorCode; message: string; detail: string }
  /** Sent, but the wait ended without an answer (timeout) or the user stopped waiting. */
  | { kind: 'unconfirmed'; signature: Signature; reason: 'timeout' | 'cancelled' };

/** What one signing run produced, for any transaction on the page. */
export type SigningRunResult = {
  /** In signing order; signers after a stop are `not-reached`. */
  signers: readonly SignerRecord[];
  /** null: not run (a signing step stopped the run). */
  verify: VerifyOutcome | null;
  /** null: not sent. */
  send: SendOutcome | null;
};

export type RunReport = SigningRunResult & {
  date: Date;
  cluster: Cluster;
  stakeAccount: Address;
  order: SigningOrder;
  lifetime: LifetimeChoice;
  /** Re-read from the chain after a confirmed run. */
  lockupAfter: { secondKey: Address; unixTimestamp: bigint; asExpected: boolean } | null;
};

/** `none`, `lighthouse-tail(n, accounts)` or `other: codes`, as the report and the page show it. */
export function changeCode(change: MessageChange): string {
  switch (change.kind) {
    case 'none':
      return 'none';
    case 'lighthouse-tail':
      return `lighthouse-tail(${[String(change.instructions), ...change.addedAccounts].join(', ')})`;
    case 'other':
      return `other: ${[...new Set(change.parts.map((part) => part.code))].join(', ')}`;
  }
}

export function formatReport(report: RunReport): string {
  const r = (key: ReportKey, params?: Record<string, string | number>) => t(`devCosign.report.${key}`, params);
  const lines = [r('heading'), r('date', { value: isoSeconds(report.date) }), r('cluster', { value: report.cluster })];
  for (const role of ['main', 'second'] as const) {
    const signer = report.signers.find((candidate) => candidate.role === role);
    if (signer === undefined) continue;
    lines.push(
      r('wallet', {
        role: t(`common.roles.${role}`),
        wallet: signer.walletName,
        version: signer.walletVersion ?? r('notStandard'),
        accounts: signer.accountsOffered,
        address: shortAddress(signer.address),
      }),
    );
  }
  lines.push(
    r('stakeAccount', { value: shortAddress(report.stakeAccount) }),
    r('order', { value: r(report.order) }),
    r('lifetime', { value: r(report.lifetime) }),
  );
  report.signers.forEach((signer, index) => {
    const who = { n: index + 1, role: t(`common.roles.${signer.role}`), wallet: signer.walletName };
    const { outcome } = signer;
    switch (outcome.kind) {
      case 'signed':
        lines.push(
          r('signer', {
            ...who,
            changed: changeCode(outcome.change),
            check: outcome.check.ok ? 'ok' : outcome.check.code,
          }),
        );
        if (outcome.change.kind === 'other') for (const part of outcome.change.parts) lines.push(indent(part.text));
        if (!outcome.check.ok) lines.push(indent(outcome.check.message));
        break;
      case 'wallet-error':
        lines.push(r('signerError', { ...who, code: outcome.code, message: outcome.message }));
        if (outcome.detail !== '') lines.push(indent(outcome.detail));
        break;
      case 'not-reached':
        lines.push(r('signerNotReached', who));
        break;
    }
  });
  lines.push(
    report.verify === null
      ? r('verifyNotRun')
      : report.verify.ok
        ? r('verifyOk')
        : r('verifyFailed', { code: report.verify.code, message: report.verify.message }),
  );
  lines.push(sendLine(report.send, report.cluster));
  if (report.lockupAfter !== null) {
    lines.push(
      r(report.lockupAfter.asExpected ? 'lockAfter' : 'lockAfterUnexpected', {
        address: shortAddress(report.lockupAfter.secondKey),
        until: isoSeconds(new Date(Number(report.lockupAfter.unixTimestamp) * 1000)),
      }),
    );
  }
  lines.push(r('fillWarnings'), r('fillLedger'), r('fillNotes'));
  return lines.join('\n');
}

type ReportKey = keyof Messages['devCosign']['report'];

function sendLine(send: SendOutcome | null, cluster: Cluster): string {
  const r = (key: ReportKey, params?: Record<string, string | number>) => t(`devCosign.report.${key}`, params);
  if (send === null) return r('notSent');
  switch (send.kind) {
    case 'confirmed':
      return r('sendConfirmed', { signature: send.signature, url: explorerUrl('tx', send.signature, cluster) });
    case 'failed':
      return [
        r('sendFailed', { code: send.code, message: send.message }),
        ...(send.signature === null ? [] : [`  ${explorerUrl('tx', send.signature, cluster)}`]),
        ...(send.detail === '' ? [] : [indent(send.detail)]),
      ].join('\n');
    case 'unconfirmed':
      return r(send.reason === 'timeout' ? 'sendTimeout' : 'sendCancelled', {
        signature: send.signature,
        url: explorerUrl('tx', send.signature, cluster),
      });
  }
}

/** Detail lines under their entry: every line indented, so a multi-line error stays under its signer. */
function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/** 2026-10-02T14:03:12Z */
function isoSeconds(date: Date): string {
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 19)}Z` : '?';
}

// ---- The running list of reports: in memory, and in localStorage as a per-viewer convenience. ----

export const REPORTS_STORAGE_KEY = 'stakeward:dev-cosign:reports:v1';
const MAX_REPORTS = 50;

/** An external store for React (useSyncExternalStore). Oldest first. */
export interface ReportStore {
  getSnapshot: () => readonly string[];
  subscribe: (listener: () => void) => () => void;
  add: (report: string) => void;
  clear: () => void;
}

export function createReportStore(storage: StorageLike | null, key = REPORTS_STORAGE_KEY): ReportStore {
  let reports = readReports(storage, key);
  const listeners = new Set<() => void>();
  const update = (next: readonly string[]) => {
    reports = next;
    try {
      if (next.length === 0) storage?.removeItem(key);
      else storage?.setItem(key, JSON.stringify(next));
    } catch {
      // Full, blocked or private: the list lives in memory for this page.
    }
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => reports,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(report) {
      update([...reports, report].slice(-MAX_REPORTS));
    },
    clear() {
      if (reports.length > 0) update([]);
    },
  };
}

function readReports(storage: StorageLike | null, key: string): readonly string[] {
  try {
    const text = storage?.getItem(key) ?? null;
    const value: unknown = text === null ? null : JSON.parse(text);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-MAX_REPORTS) : [];
  } catch {
    return [];
  }
}
