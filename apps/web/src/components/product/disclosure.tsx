import { cn } from 'cn';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type DisclosureProps = {
  /** The always visible part: what opening it shows ("Details", "Technical details", a question). */
  summary: ReactNode;
  /** Element id; a link to `#<id>` can open it (the landing's useHashTarget). */
  id?: string | undefined;
  defaultOpen?: boolean | undefined;
  /**
   * `inline` (default): a text link with a chevron that turns right to down, for "Details" under an error.
   * `row`: a full-width line with a chevron at its end that turns over, for a list of questions.
   */
  variant?: 'inline' | 'row';
  className?: string | undefined;
  children: ReactNode;
};

/**
 * Text that folds away (DECISIONS.md D112): a native <details>, so the browser opens it from the keyboard (Enter,
 * Space), from find-in-page and from a link's hash, with no script (D3). Never for a risk before an irreversible
 * action, the signing screen's guarantees or a sign of theft: those stay visible.
 */
export function Disclosure({ summary, id, defaultOpen, variant = 'inline', className, children }: DisclosureProps) {
  const row = variant === 'row';
  return (
    <details
      id={id}
      open={defaultOpen === true ? true : undefined}
      data-slot="disclosure"
      data-variant={variant}
      className={cn('group', className)}
    >
      <summary
        className={cn(
          'summary-plain cursor-pointer rounded-sm',
          row
            ? 'flex w-full items-center justify-between gap-3 py-3 text-left font-medium'
            : 'inline-flex w-fit items-center gap-1 font-medium text-primary underline underline-offset-4 hover:text-primary-hover',
        )}
      >
        {summary}
        {row ? (
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
        ) : (
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        )}
      </summary>
      <div className={row ? 'flex flex-col gap-2 pb-4' : 'mt-2'}>{children}</div>
    </details>
  );
}
