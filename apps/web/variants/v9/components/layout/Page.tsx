import { cn } from 'cn';
import { ShieldIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type PageProps = {
  /** `app`: the full content width (landing, /app, /recovery). `flow`: a centred column for flows (/protect, ...). */
  width?: 'app' | 'flow';
  children: ReactNode;
  className?: string | undefined;
};

/**
 * v9 "Conversation": every page is a thread, so both widths are a reading column. `app` is the wider thread (account
 * attachments need the room), `flow` the narrow one of a guided step.
 */
const WIDTH: Record<NonNullable<PageProps['width']>, string> = {
  app: 'mx-auto flex w-full max-w-3xl flex-col gap-6 sm:gap-8',
  flow: 'mx-auto flex w-full max-w-2xl flex-col gap-6 sm:gap-8',
};

export function Page({ width = 'app', children, className }: PageProps) {
  return (
    <div data-slot="page" data-width={width} className={cn(WIDTH[width], className)}>
      {children}
    </div>
  );
}

/*
 * Thread primitives of the v9 variant. They live here because the variant overlay can only replace files that exist
 * in src/, and every page already imports this one.
 */

/** Stakeward's avatar: a calm shield on the accent, the same in every message. Decorative. */
export function Avatar({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-bubble-out text-on-bubble-out',
        size === 'md' ? 'size-9' : 'size-7',
        className,
      )}
    >
      <ShieldIcon className={size === 'md' ? 'size-4.5' : 'size-3.5'} strokeWidth={2.25} />
    </span>
  );
}

/**
 * One message from Stakeward: the avatar on the first message of a run, a blank of the same width on the rest, so a
 * run of bubbles reads as one speaker.
 */
export function FromStakeward({
  children,
  first = false,
  className,
}: {
  children: ReactNode;
  first?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn('flex items-end gap-2.5 sm:gap-3', className)}>
      {first ? <Avatar /> : <span aria-hidden="true" className="w-9 shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">{children}</div>
    </div>
  );
}

/** A bubble from Stakeward. `wide` lets an attachment-like bubble take the whole column. */
export function Bubble({
  children,
  wide = false,
  tone = 'plain',
  className,
}: {
  children: ReactNode;
  wide?: boolean | undefined;
  tone?: 'plain' | 'warning' | undefined;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        'bubble-in px-4 py-2.5 text-base text-pretty',
        wide ? 'w-full' : 'max-w-[34rem]',
        tone === 'warning' && 'border-warning-border bg-warning-soft',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A message from the visitor: right-aligned, on the accent. */
export function FromVisitor({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('flex justify-end pl-10 sm:pl-24', className)}>
      <div className="bubble-out max-w-full px-4 py-2.5 text-base font-medium text-pretty">{children}</div>
    </div>
  );
}

/** "Stakeward is typing": three dots in a bubble. The dots hold still under prefers-reduced-motion. */
export function TypingIndicator({ label }: { label: string }) {
  return (
    <FromStakeward first>
      <div className="bubble-in flex h-10 items-center gap-1 px-4" role="status" aria-label={label}>
        <span className="typing-dot size-1.5 rounded-full bg-muted" />
        <span className="typing-dot size-1.5 rounded-full bg-muted" />
        <span className="typing-dot size-1.5 rounded-full bg-muted" />
      </div>
    </FromStakeward>
  );
}

/** A quiet line across the thread: what network this is, a day, a change of subject. */
export function ThreadDivider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="text-center text-balance">{children}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Suggested replies: right-aligned pills, the visitor's side of the thread. */
export function ReplyChips({ label, children, className }: { label: string; children: ReactNode; className?: string | undefined }) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap justify-end gap-2 pl-6 sm:pl-24', className)}>
      {children}
    </div>
  );
}

/** The look of one suggested reply, for a <button> or a link. */
export const CHIP_CLASS =
  'inline-flex min-h-10 items-center gap-2 rounded-full border border-primary/35 bg-surface px-4 py-2 text-left text-sm font-semibold text-primary transition-colors hover:border-primary hover:bg-primary-soft [&_svg]:size-4 [&_svg]:shrink-0';
