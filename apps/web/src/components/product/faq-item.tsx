import { cn } from 'cn';
import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type FaqItemProps = {
  /** Element id; a link to `#<id>` opens this item (landing useHashTarget). */
  id: string;
  question: string;
  /** The answer, as paragraphs. */
  children: ReactNode;
  defaultOpen?: boolean | undefined;
  className?: string | undefined;
};

/**
 * One question of the FAQ: a native <details> (no Radix, DECISIONS.md D3), so the browser opens it from the
 * keyboard (Enter, Space), from find-in-page and from a link's hash. States: closed and open.
 */
export function FaqItem({ id, question, children, defaultOpen, className }: FaqItemProps) {
  return (
    <details
      id={id}
      open={defaultOpen === true ? true : undefined}
      data-slot="faq-item"
      className={cn('group rounded-lg border border-border bg-surface', className)}
    >
      <summary className="summary-plain flex cursor-pointer items-center justify-between gap-3 rounded-lg px-4 py-3 font-medium">
        <span>{question}</span>
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-2 px-4 pb-4 text-sm break-words text-foreground">{children}</div>
    </details>
  );
}
