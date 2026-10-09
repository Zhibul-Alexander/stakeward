import { SignerListSkeleton, TransactionSummarySkeleton } from '@stakeward/design-system';
import { LoaderCircleIcon } from 'lucide-react';

/** While the signing screen inspects the bytes (signatures are checked with Web Crypto): the receipt's shape. */
export const Loading = () => <TransactionSummarySkeleton />;

/** A signing panel while its transactions are built: the compact signer order above the summary, both loading. */
export const SigningPanelLoading = () => (
  <div className="flex flex-col gap-4">
    <SignerListSkeleton variant="compact" />
    <TransactionSummarySkeleton />
  </div>
);

/** /cosign reading the link: the wait is said in words above the summary's shape, as CosignPage renders it. */
export const CosignReadingLink = () => (
  <div aria-busy="true" className="flex flex-col gap-3">
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
      Checking the link
    </p>
    <TransactionSummarySkeleton />
  </div>
);
