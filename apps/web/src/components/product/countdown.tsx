import { formatUtcDate } from '@stakeward/core';
import { cn } from 'cn';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

/** True while the user asks for reduced motion (jsdom and old browsers without matchMedia: false). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

function remainingSeconds(to: bigint, nowMs: number): number {
  return Math.max(0, Number(to) - Math.floor(nowMs / 1000));
}

/**
 * `3 h 05 min`, `12 min 09 s`, `2 d 4 h`. Seconds only in the last hour, and never when `coarse` (reduced motion:
 * the text then changes once a minute, rounded up so it never claims less time than is left).
 */
export function formatRemaining(seconds: number, coarse: boolean): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return `${t('components.countdown.days', { value: days })} ${t('components.countdown.hours', { value: hours })}`;
  }
  if (hours > 0) {
    return `${t('components.countdown.hours', { value: hours })} ${t('components.countdown.minutes', { value: pad(minutes) })}`;
  }
  if (coarse) return t('components.countdown.minutes', { value: Math.max(1, Math.ceil(s / 60)) });
  if (minutes > 0) {
    return `${t('components.countdown.minutes', { value: minutes })} ${t('components.countdown.seconds', { value: pad(secs) })}`;
  }
  return t('components.countdown.seconds', { value: secs });
}

/** Screen readers hear the countdown only when it crosses one of these (seconds left), and when it ends. */
const MILESTONES = [3_600, 1_800, 600, 300, 60] as const;

function milestoneBucket(seconds: number): number {
  if (seconds <= 0) return MILESTONES.length + 1;
  return MILESTONES.filter((m) => seconds <= m).length;
}

function endsAtText(to: bigint): string | null {
  const date = formatUtcDate(to);
  if (date === null) return null;
  const at = new Date(Number(to) * 1000);
  const time = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
  return t('components.countdown.endsAt', { time, date });
}

type CountdownProps = {
  /** Target, unix seconds (e.g. the estimated end of the current epoch). */
  to: bigint;
  /** What is counted down, e.g. "Current epoch ends in". */
  label: string;
  /** Called once when the countdown reaches zero (keep it stable: useCallback). */
  onEnd?: (() => void) | undefined;
  /** Milliseconds since the epoch; tests pass a fake clock. Keep it stable. */
  clock?: (() => number) | undefined;
  className?: string | undefined;
};

/**
 * A wait the user can see (UX rule 7). The visible value is a `timer` (not announced on every tick); a polite live
 * region speaks only at milestones (1 h, 30, 10, 5 and 1 min left) and at the end. With prefers-reduced-motion the
 * display changes once a minute instead of every second.
 */
export function Countdown({ to, label, onEnd, clock = Date.now, className }: CountdownProps) {
  const labelId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const [nowMs, setNowMs] = useState(() => clock());
  const [announcement, setAnnouncement] = useState('');
  const onEndRef = useRef(onEnd);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    let bucket = milestoneBucket(remainingSeconds(to, clock()));
    // Already over when shown: nothing to tick or announce (onEnd is for a countdown that runs out on screen).
    if (bucket > MILESTONES.length) return undefined;
    let ended = false;
    const tick = () => {
      const ms = clock();
      setNowMs(ms);
      const left = remainingSeconds(to, ms);
      const next = milestoneBucket(left);
      if (next !== bucket) {
        bucket = next;
        setAnnouncement(
          left <= 0 ? t('components.countdown.ended') : t('components.countdown.left', { time: formatRemaining(left, true) }),
        );
      }
      if (left <= 0 && !ended) {
        ended = true;
        clearInterval(timer);
        onEndRef.current?.();
      }
    };
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [to, clock]);

  const left = remainingSeconds(to, nowMs);
  const endsAt = endsAtText(to);
  // formatUtcDate returns null outside the range of a Date; toISOString would throw there.
  const dateTime = endsAt === null ? undefined : new Date(Number(to) * 1000).toISOString();
  return (
    <div data-slot="countdown" className={cn('flex flex-col gap-1', className)}>
      <span id={labelId} className="text-sm text-muted">
        {label}
      </span>
      <time
        role="timer"
        aria-labelledby={labelId}
        dateTime={dateTime}
        className="text-2xl font-semibold tabular-nums"
      >
        {left <= 0 ? t('components.countdown.ended') : formatRemaining(left, reducedMotion)}
      </time>
      {endsAt === null ? null : <span className="text-xs text-muted">{endsAt}</span>}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

export function CountdownSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-40" />
    </div>
  );
}
