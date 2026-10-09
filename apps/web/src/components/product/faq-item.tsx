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
 * One question of the FAQ: a row of a list, with no frame of its own (the list draws the lines between rows). A native
 * <details> (no Radix, DECISIONS.md D3), so the browser opens it from the keyboard (Enter, Space), from find-in-page
 * and from a link's hash. It looks like Disclosure's `row` variant; it is its own <details> so it can keep
 * `data-slot="faq-item"`. A named group (`group/faq-item`): it sits inside an FAQ group that is a <details> too, and the
 * chevron turns with this item only. The question is `text-sm` at every width, so it reads one level below the FAQ
 * group's h3; the answer keeps a reading measure (`max-w-prose`) on a wide screen. States: closed and open.
 */
export function FaqItem({ id, question, children, defaultOpen, className }: FaqItemProps) {
  return (
    <details id={id} open={defaultOpen === true ? true : undefined} data-slot="faq-item" className={cn('group/faq-item', className)}>
      <summary className="summary-plain flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm py-2 text-left text-sm font-medium sm:py-3">
        <span className="text-pretty">{question}</span>
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 text-muted transition-transform group-open/faq-item:rotate-180" />
      </summary>
      <div className="flex max-w-prose flex-col gap-2 pb-3 text-sm break-words text-foreground sm:pb-4">{children}</div>
    </details>
  );
}
