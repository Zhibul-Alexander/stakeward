import type { Address } from '@solana/kit';
import { OctagonXIcon } from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AddressText } from './address-text.tsx';
import { ErrorDetails } from './error-state.tsx';

export type StopPanelAddress = { label: string; address: Address };

type StopPanelProps = {
  /** The h2: "Do not sign this link". */
  title: string;
  /** Why, in one line. */
  reason: ReactNode;
  /** Addresses the reason is about, labelled and in full (DECISIONS.md D23): where the SOL would go, whose stake it is. */
  addresses?: readonly StopPanelAddress[] | undefined;
  /** "What to do: ..." when the link may come from a thief. */
  whatToDo?: string | undefined;
  /** The inspector's own words, under Details (UX rule 8). */
  detail?: string | undefined;
  /** The one way out, an outline button ("Back to the start page"). */
  action?: ReactNode;
  /** Pages that move focus to the panel's heading when it replaces what was there. */
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** What the panel refuses, for tests and styling hooks (`data-reason`). */
  reasonCode?: string | undefined;
  className?: string | undefined;
};

/**
 * "Do not sign" on /cosign (DECISIONS.md D109): the loudest thing on the page and the only red one. A framed danger
 * alert at its large size, its own h2, the reason, the addresses it is about in full, what to do and one way out.
 * Never folded: the decision is made here.
 */
export function StopPanel({ title, reason, addresses, whatToDo, detail, action, headingRef, reasonCode, className }: StopPanelProps) {
  const titleId = useId();
  return (
    <Alert tone="danger" size="lg" aria-labelledby={titleId} data-slot="stop-panel" data-reason={reasonCode} className={className}>
      <OctagonXIcon aria-hidden="true" />
      <h2 id={titleId} ref={headingRef} tabIndex={headingRef === undefined ? undefined : -1} className="text-2xl text-balance">
        {title}
      </h2>
      <AlertDescription className="flex flex-col gap-4 text-foreground [&_p:not(:last-child)]:mb-0">
        <p className="font-medium">{reason}</p>
        {addresses === undefined || addresses.length === 0 ? null : (
          <dl className="flex flex-col gap-3">
            {addresses.map((item) => (
              <div key={`${item.label}-${item.address}`} className="flex flex-col gap-0.5">
                <dt className="text-sm font-semibold">{item.label}</dt>
                <dd>
                  <AddressText address={item.address} variant="full" explorer />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {whatToDo === undefined ? null : <p>{whatToDo}</p>}
        {detail === undefined ? null : <ErrorDetails detail={detail} />}
        {action === undefined ? null : <div className="flex flex-wrap gap-2">{action}</div>}
      </AlertDescription>
    </Alert>
  );
}
