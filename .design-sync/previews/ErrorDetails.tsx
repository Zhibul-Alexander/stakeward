import { Button, ErrorDetails } from '@stakeward/design-system';
import { CircleXIcon, RefreshCwIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { MonitoringStatus } from '../../apps/web/src/pages/app/MonitoringStatus';

const NOW = 1_791_504_000_000;

/** Opens the native <details> once mounted, as a click on Details would: ErrorDetails has no open prop. */
function Opened({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const details = ref.current?.querySelector('details');
    if (details) details.open = true;
  }, []);
  return <div ref={ref}>{children}</div>;
}

/**
 * Closed and muted, in /app's monitoring line when GET /api/health gave no answer within 8 s: what to do, Refresh
 * beside it, and the raw error one click away.
 */
export const Closed = () => (
  <section aria-label="Summary" className="flex flex-wrap items-center gap-x-4 gap-y-2">
    <MonitoringStatus state={{ status: 'error', detail: 'TimeoutError: No answer within 8 s' }} now={NOW} />
    <Button variant="ghost" size="icon-sm" aria-label="Refresh">
      <RefreshCwIcon aria-hidden="true" />
    </Button>
  </section>
);

/** Open, under the protect Done screen's monitoring line: the original message in mono, shown as plain text. */
export const Open = () => (
  <Opened>
    <div className="flex flex-col gap-1 pl-9 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex items-start gap-2 font-medium">
          <CircleXIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          Monitoring could not be turned on right now. Your stake is still protected on the network.
        </p>
        <Button variant="ghost" size="sm">
          <RotateCcwIcon aria-hidden="true" />
          Turn on monitoring
        </Button>
      </div>
      <ErrorDetails detail="TypeError: Failed to fetch" />
    </div>
  </Opened>
);

/** Several lines kept as they came: one per stake account the monitor turned away, with the worker's reason. */
export const MultiLine = () => (
  <Opened>
    <div className="flex flex-col gap-1 pl-9 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex items-start gap-2 font-medium">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          Monitoring is on for some of them. Turn it on for the rest in a minute.
        </p>
        <Button variant="ghost" size="sm">
          <RotateCcwIcon aria-hidden="true" />
          Turn on monitoring
        </Button>
      </div>
      <ErrorDetails
        detail={[
          'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW: not-locked',
          '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6: not-found',
        ].join('\n')}
      />
    </div>
  </Opened>
);
