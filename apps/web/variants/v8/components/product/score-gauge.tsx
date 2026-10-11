import { cn } from 'cn';

/**
 * The checklist gauge (v8): one arc segment per scored check, green when it passes. The numeral is passed / scored as a
 * share of 100, nothing more: unknown, optional-advice and reminder items are not in it. Empty (no result yet) the
 * arc is drawn as grey placeholders and the numeral is a dash.
 */
export function ScoreGauge({
  passed,
  total,
  placeholderSegments = 5,
  onBand = false,
  className,
}: {
  /** On the checklist's dark band: the numeral and its caption take the band's colours. */
  onBand?: boolean;
  passed?: number | undefined;
  total?: number | undefined;
  placeholderSegments?: number;
  className?: string | undefined;
}) {
  const empty = passed === undefined || total === undefined || total === 0;
  const count = empty ? placeholderSegments : total;
  const score = empty ? null : Math.round((passed / total) * 100);
  const sweep = 270;
  const gap = count > 1 ? 4 : 0;
  const per = sweep / count;
  const segments = Array.from({ length: count }, (_, index) => {
    const from = 135 + index * per + gap / 2;
    const to = 135 + (index + 1) * per - gap / 2;
    return { d: arc(100, 100, 78, from, to), done: !empty && index < passed };
  });
  return (
    <div className={cn('relative mx-auto aspect-square w-full max-w-56', className)}>
      <svg viewBox="0 0 200 200" aria-hidden="true" className="size-full">
        {segments.map((segment, index) => (
          <path
            key={index}
            d={segment.d}
            fill="none"
            strokeWidth={16}
            className={empty ? (onBand ? 'stroke-band-muted opacity-40' : 'stroke-subtle-hover') : segment.done ? 'stroke-done' : 'stroke-todo'}
          />
        ))}
      </svg>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center font-mono text-3xl font-medium tabular-nums sm:text-4xl',
          onBand ? 'text-on-band' : 'text-foreground',
        )}
      >
        {score === null ? '–' : String(score)}
      </span>
      {/* In the arc's open bottom. */}
      <span className={cn('absolute inset-x-0 bottom-[4%] text-center font-mono text-xs', onBand ? 'text-band-muted' : 'text-muted')}>out of 100</span>
    </div>
  );
}

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const from = (fromDeg * Math.PI) / 180;
  const to = (toDeg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(from);
  const y1 = cy + r * Math.sin(from);
  const x2 = cx + r * Math.cos(to);
  const y2 = cy + r * Math.sin(to);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${String(r)} ${String(r)} 0 ${String(large)} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
