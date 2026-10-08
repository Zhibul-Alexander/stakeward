import { CircleXIcon, LoaderCircleIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { TransactionSummaryError, TransactionSummarySkeleton } from '@/components/product/transaction-summary';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import type { SigningTestOptions } from '@/signing/create';
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
 */
export function CosignPage({ fragment: given, signing }: CosignPageProps) {
  const locationHash = useLocationHash();
  const fragment = given ?? locationHash;
  const read = useLoad(`link#${fragment}`, () => readLink(fragment));
  return (
    <Page width="flow">
      <PageHeader
        title={t('common.pages.cosign')}
        lead={t('cosign.intro')}
        meta={
          <>
            <p>{t('common.neverSeedPhrase')}</p>
            <p>
              {/* Opens the landing on its card for someone who was sent a link to co-sign. */}
              <Link
                href="/#for-second-key"
                className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
              >
                {t('cosign.whatIs')}
              </Link>
            </p>
          </>
        }
      />
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
        <LinkContent read={read.value} fragment={fragment} signing={signing} />
      )}
    </Page>
  );
}

function LinkContent({ read, fragment, signing }: { read: LinkRead; fragment: string; signing: SigningTestOptions | undefined }) {
  switch (read.kind) {
    case 'bad':
      return <BrokenLink />;
    case 'rejected':
      return <TransactionSummaryError error={read.error} action={<BackHome />} />;
    case 'problem':
      return (
        <Alert tone="danger" data-slot="link-problem" data-problem={read.problem}>
          <CircleXIcon aria-hidden="true" />
          <h2 data-slot="alert-title" className="font-semibold">
            {t('components.tx.rejectedTitle')}
          </h2>
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p className="font-medium">{t(`cosign.problem.${read.problem}`)}</p>
            <div>
              <BackHome />
            </div>
          </AlertDescription>
        </Alert>
      );
    case 'ok':
      // One session per link: a new fragment (hashchange) is a new page state.
      return <CosignSigning key={fragment} bytes={read.bytes} summary={read.summary} fragment={fragment} signing={signing} />;
  }
}

/** The fragment holds no transaction Stakeward can read: say so, and that nothing was signed. */
function BrokenLink() {
  return (
    <Alert tone="danger" data-slot="link-broken">
      <CircleXIcon aria-hidden="true" />
      <h2 data-slot="alert-title" className="font-semibold">
        {t('cosign.bad.title')}
      </h2>
      <AlertDescription className="flex flex-col gap-2 text-foreground">
        <p>{t('cosign.bad.body')}</p>
        <div>
          <BackHome />
        </div>
      </AlertDescription>
    </Alert>
  );
}

function BackHome() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/">{t('common.backHome')}</Link>
    </Button>
  );
}
