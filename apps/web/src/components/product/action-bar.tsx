import { cn } from 'cn';
import type { ReactNode } from 'react';

type ActionBarProps = {
  /** RiskNote (usually `variant="inline"`), directly above the buttons it guards (UX rule 6). */
  risk?: ReactNode;
  /** One muted line: who signs first, the fee, why the step cannot go on yet. */
  note?: ReactNode;
  /** The screen's one filled button, or an outline one while the step is blocked. Full width below 640 px. */
  primary: ReactNode;
  /** Back (ghost) or one alternative (outline). */
  secondary?: ReactNode;
  className?: string | undefined;
};

/**
 * The block that ends every flow step and every signing panel (DECISIONS.md D109): the risk, one line of context, then
 * the main button with Back or one alternative next to it. Never sticky: the decision is made after reading the step.
 */
export function ActionBar({ risk, note, primary, secondary, className }: ActionBarProps) {
  return (
    <div data-slot="action-bar" className={cn('flex flex-col gap-3', className)}>
      {risk}
      {note === undefined ? null : <div className="text-sm text-muted">{note}</div>}
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
        <div className="flex w-full flex-col sm:w-auto [&>[data-slot=button]]:w-full sm:[&>[data-slot=button]]:w-auto">{primary}</div>
        {secondary}
      </div>
    </div>
  );
}
