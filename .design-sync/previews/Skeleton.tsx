import { Badge, RadioCardGroup, Skeleton, Spinner } from '@stakeward/design-system';
import { LoaderCircleIcon } from 'lucide-react';

const noop = () => undefined;

/** A heading and its lead line while a block loads (the signing summary's first lines). Decorative: aria-hidden. */
export const TextLines = () => (
  <div className="flex flex-col gap-2" aria-hidden="true">
    <Skeleton className="h-7 w-56" />
    <Skeleton className="h-4 w-full max-w-md" />
  </div>
);

/**
 * Circle, bar and pill rows: who signs, while the signing panel builds the transaction (the compact signer list's
 * loading shape). Decorative: aria-hidden.
 */
export const SignerRows = () => (
  <div aria-hidden="true" className="flex flex-col gap-2">
    {[0, 1].map((key) => (
      <div key={key} className="flex items-center gap-2">
        <Skeleton className="size-6 rounded-full" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
    ))}
  </div>
);

/** Inline in text: the lock periods while the network time is read, each end date a skeleton until it is known. */
export const PeriodDates = () => (
  <div className="flex flex-col gap-6">
    <RadioCardGroup
      legend="Lock period"
      legendHidden
      columns={2}
      value="6-months"
      onValueChange={noop}
      options={[
        { value: '1-month', title: '1 month', meta: <Skeleton className="inline-block h-4 w-32 align-middle" /> },
        { value: '3-months', title: '3 months', meta: <Skeleton className="inline-block h-4 w-32 align-middle" /> },
        {
          value: '6-months',
          title: '6 months',
          meta: <Skeleton className="inline-block h-4 w-32 align-middle" />,
          badge: <Badge tone="success">Recommended</Badge>,
        },
        { value: '12-months', title: '12 months', meta: <Skeleton className="inline-block h-4 w-32 align-middle" /> },
      ]}
    />
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
      Reading the network time
    </p>
  </div>
);

/** The stats page while the numbers load: a spoken status line over three tiles. */
export const StatTiles = () => (
  <div aria-busy="true" className="flex flex-col gap-4">
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <Spinner aria-hidden="true" className="text-muted" />
      Loading the numbers
    </p>
    <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
      <Skeleton className="h-24 rounded-lg sm:h-28" />
      <Skeleton className="h-24 rounded-lg sm:h-28" />
      <Skeleton className="h-24 rounded-lg sm:h-28" />
    </div>
  </div>
);
