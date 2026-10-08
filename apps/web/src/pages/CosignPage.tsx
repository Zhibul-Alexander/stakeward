import { formatSol, type CosignLinkProblem, type InspectError, type TransactionSummary } from '@stakeward/core';
import { LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ErrorDetails } from '@/components/product/error-state';
import { StopPanel, type StopPanelAddress } from '@/components/product/stop-panel';
import { TransactionSummarySkeleton } from '@/components/product/transaction-summary';
import { Page } from '@/components/layout/Page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import type { SigningTestOptions } from '@/signing/create';
import { BackHome, CosignHeader } from './cosign/CosignHeader.tsx';
import { CosignSigning } from './cosign/CosignSigning.tsx';
import { readLink, useLocationHash, type LinkRead } from './cosign/read.ts';

type CosignPageProps = {
  /** The link's fragment (`#tx=...`); the page address's own fragment when left out. Tests pass it. */
  fragment?: string | undefined;
  /** Tests poll and re-read faster; the product uses the engine's defaults. */
  signing?: SigningTestOptions | undefined;
};

/**
 * /cosign (CLAUDE.md section 6, DECISIONS.md D69): the second device of signing by link. The page trusts only the
 * link's bytes and the chain. The fragment never reaches the server; the inspector and the link-format rules read it
 * before any chain read, and nothing is signed or sent before the chain check (plan.ts) and the simulation pass. Every
 * remaining signer signs here (no chaining). Works in a phone wallet's own browser with one signer (UX rule 10).
 * A link refused here gets "Do not sign" as the first thing under the h1 (StopPanel); a broken one says so in
 * warning colours, since it is not hostile (DECISIONS.md D103).
 */
export function CosignPage({ fragment: given, signing }: CosignPageProps) {
  const locationHash = useLocationHash();
  const fragment = given ?? locationHash;
  const read = useLoad(`link#${fragment}`, () => readLink(fragment));
  if (read.status === 'ready' && read.value.kind === 'ok') {
    // One session per link: a new fragment (hashchange) is a new page state. It renders its own header.
    return (
      <Page width="flow">
        <CosignSigning key={fragment} bytes={read.value.bytes} summary={read.value.summary} fragment={fragment} signing={signing} />
      </Page>
    );
  }
  return (
    <Page width="flow">
      <CosignHeader lead={false} />
      {read.status === 'idle' || read.status === 'loading' ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            {t('cosign.reading')}
          </p>
          <TransactionSummarySkeleton />
        </div>
      ) : read.status === 'error' ? (
        <BrokenLink />
      ) : (
        <Refusal read={read.value} />
      )}
    </Page>
  );
}

/** A link this page will not sign, read from its bytes alone: broken, unreadable here, or not one Stakeward makes. */
function Refusal({ read }: { read: LinkRead }) {
  switch (read.kind) {
    case 'bad':
    case 'ok':
      // `ok` never gets here (CosignPage signs it); a bad link holds nothing to show.
      return <BrokenLink />;
    case 'rejected':
      return read.error.code === 'verification-unavailable' ? <Unverifiable error={read.error} /> : <Rejected error={read.error} />;
    case 'problem':
      return <Problem problem={read.problem} summary={read.summary} />;
  }
}

/** Problems that a thief's link would have: the owner should hear of it. */
const HOSTILE: ReadonlySet<CosignLinkProblem> = new Set(['foreign-recipient', 'unexpected-fee-payer', 'nonce-not-fee-payer']);

/** Bytes the inspector refuses: "Do not sign", its reason, and its own words under Details. */
function Rejected({ error }: { error: InspectError }) {
  return (
    <StopPanel
      title={t('cosign.stop.title')}
      reason={t(`components.tx.rejected.${error.code}`)}
      whatToDo={t('cosign.stop.whatToDo')}
      detail={error.message}
      action={<BackHome />}
      reasonCode={error.code}
    />
  );
}

/** A transaction Stakeward could read but never sends by link: "Do not sign" and why, with the addresses it is about. */
function Problem({ problem, summary }: { problem: CosignLinkProblem; summary: TransactionSummary }) {
  const { action } = summary;
  let reason: ReactNode = t(`cosign.problem.${problem}`);
  let addresses: StopPanelAddress[] = [];
  if (problem === 'foreign-recipient' && action.kind === 'withdraw') {
    reason = t('cosign.problem.foreign-recipient', { amount: formatSol(action.lamports) });
    addresses = [
      { label: t('cosign.stop.goesTo'), address: action.recipient },
      { label: t('cosign.stop.mainKey'), address: action.mainKey },
    ];
  }
  return (
    <StopPanel
      title={t('cosign.stop.title')}
      reason={reason}
      addresses={addresses}
      whatToDo={HOSTILE.has(problem) ? t('cosign.stop.whatToDo') : undefined}
      action={<BackHome />}
      reasonCode={problem}
    />
  );
}

/** This browser cannot check signatures: the link may be fine, so open it elsewhere (not "Do not sign"). */
function Unverifiable({ error }: { error: InspectError }) {
  return (
    <Alert tone="warning" data-slot="link-unverifiable">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>
        <h2 className="text-lg">{t('cosign.unverifiable.title')}</h2>
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-foreground [&_p:not(:last-child)]:mb-0">
        <p>{t('components.tx.rejected.verification-unavailable')}</p>
        <ErrorDetails detail={error.message} />
        <div>
          <BackHome />
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** The fragment holds no whole transaction (cut off, or not a link at all): ask for the whole link; nothing was signed. */
function BrokenLink() {
  return (
    <Alert tone="warning" data-slot="link-broken">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>
        <h2 className="text-lg">{t('cosign.bad.title')}</h2>
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-foreground [&_p:not(:last-child)]:mb-0">
        <p>{t('cosign.bad.body')}</p>
        <div>
          <BackHome />
        </div>
      </AlertDescription>
    </Alert>
  );
}
