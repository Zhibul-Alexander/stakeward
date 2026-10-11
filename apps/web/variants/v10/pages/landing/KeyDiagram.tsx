import { cn } from 'cn';
import { BanIcon, CheckIcon, ClockIcon, KeyRoundIcon, WalletIcon, type LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';

/**
 * v10 centrepiece: the stake account drawn as a strongbox with two keyholes, and what each key can do alone. A picked
 * scenario (who holds which key) turns each path on or off. The drawing is illustrative; the list beside it is real
 * text, so a screen reader hears the same answer. Rules from CLAUDE.md section 4: Withdraw and a new owner need the
 * second key while the lock holds; the lock itself is changed by the second key alone; unstaking, moving and splitting
 * need only the main key; rescue = main key + second key + new wallet.
 */

type KeyId = 'main' | 'second' | 'new';
type ScenarioId = 'thief' | 'lost' | 'secondStolen' | 'rescue';
type Result = 'yes' | 'no' | 'later';

type Scenario = {
  id: ScenarioId;
  label: string;
  /** Who acts, and with which keys. */
  who: string;
  holds: readonly KeyId[];
  /** The word under each keyhole. */
  holder: Record<'main' | 'second', { word: string; tone: 'you' | 'thief' | 'lost' }>;
  caption: string;
  /** Exceptions to "works when every needed key is held". */
  later?: readonly string[];
};

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'thief',
    label: 'Thief has the main key',
    who: 'The thief, holding your main key',
    holds: ['main'],
    holder: { main: { word: 'Thief', tone: 'thief' }, second: { word: 'You', tone: 'you' } },
    caption: 'They can stop or move your staking. No SOL leaves the account while the lock holds.',
  },
  {
    id: 'lost',
    label: 'You lost the second key',
    who: 'You, holding only the main key',
    holds: ['main'],
    holder: { main: { word: 'You', tone: 'you' }, second: { word: 'Lost', tone: 'lost' } },
    caption: 'You wait for the end date. After it, your main key works alone again.',
    later: ['withdraw', 'owner', 'lock'],
  },
  {
    id: 'secondStolen',
    label: 'Thief has the second key',
    who: 'The thief, holding your second key',
    holds: ['second'],
    holder: { main: { word: 'You', tone: 'you' }, second: { word: 'Thief', tone: 'thief' } },
    caption: 'The honest limit: whoever holds the second key can freeze the stake by moving the date. Never take it.',
  },
  {
    id: 'rescue',
    label: 'Both keys + new wallet',
    who: 'You, with both keys and a new wallet',
    holds: ['main', 'second', 'new'],
    holder: { main: { word: 'You', tone: 'you' }, second: { word: 'You', tone: 'you' } },
    caption: 'All three sign once. The stake moves to the new wallet, out of the thief’s reach.',
  },
];

const ACTIONS: readonly { id: string; label: string; needs: readonly KeyId[] }[] = [
  { id: 'withdraw', label: 'Withdraw SOL', needs: ['main', 'second'] },
  { id: 'owner', label: 'Hand the stake to another wallet', needs: ['main', 'second'] },
  { id: 'lock', label: 'Change or remove the lock', needs: ['second'] },
  { id: 'unstake', label: 'Stop staking', needs: ['main'] },
  { id: 'move', label: 'Move to another validator', needs: ['main'] },
  { id: 'split', label: 'Split into smaller accounts', needs: ['main'] },
  { id: 'rescue', label: 'Rescue to a new wallet', needs: ['main', 'second', 'new'] },
];

const KEY_NAME: Record<KeyId, string> = { main: 'Main key', second: 'Second key', new: 'New wallet' };
const KEY_SHORT: Record<KeyId, string> = { main: 'Main', second: 'Second', new: 'New' };

const RESULT: Record<Result, { word: string; icon: LucideIcon; className: string }> = {
  yes: { word: 'Can', icon: CheckIcon, className: 'text-foreground' },
  no: { word: 'Cannot', icon: BanIcon, className: 'text-danger' },
  later: { word: 'After the date', icon: ClockIcon, className: 'text-accent-ink' },
};

function resultOf(scenario: Scenario, action: (typeof ACTIONS)[number]): Result {
  const works = action.needs.every((key) => scenario.holds.includes(key));
  if (works) return 'yes';
  // After the end date the lock no longer asks for the second key: the main key alone can do these again.
  if (scenario.later?.includes(action.id) === true && action.needs.every((key) => key === 'main' || key === 'second')) return 'later';
  return 'no';
}

export function KeyDiagram() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('thief');
  const scenario = SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0]!;
  const name = useId();
  const captionId = useId();
  const can = ACTIONS.filter((action) => resultOf(scenario, action) === 'yes').length;

  return (
    <figure
      aria-labelledby={captionId}
      className="relative overflow-hidden rounded-lg border border-line bg-surface bg-blueprint shadow-lg"
    >
      <fieldset className="flex flex-col gap-3 border-b border-line bg-surface px-4 py-4 sm:px-6">
        <legend className="sr-only">Who holds which key?</legend>
        <p aria-hidden="true" className="font-display text-sm font-medium text-muted">
          Who holds which key?
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {SCENARIOS.map((item) => (
            <label
              key={item.id}
              className={cn(
                'relative flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-center font-display text-sm font-medium transition-colors',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                item.id === scenarioId
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border bg-surface text-foreground hover:border-line hover:bg-subtle',
              )}
            >
              <input
                type="radio"
                name={name}
                value={item.id}
                checked={item.id === scenarioId}
                onChange={() => {
                  setScenarioId(item.id);
                }}
                className="sr-only"
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-0">
        <Strongbox scenario={scenario} />

        <div className="flex min-w-0 flex-col gap-3 md:pl-2">
          <p aria-live="polite" className="font-display text-base font-semibold">
            {scenario.who}
            <span className="sr-only">: can do {can} of {ACTIONS.length}.</span>
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
            {ACTIONS.map((action) => {
              const result = resultOf(scenario, action);
              const look = RESULT[result];
              const Icon = look.icon;
              return (
                <li
                  key={action.id}
                  data-result={result}
                  className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto_7rem] sm:gap-x-3 sm:px-3"
                >
                  <Arrow result={result} />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-medium text-pretty">{action.label}</span>
                    <span className="flex flex-wrap gap-1 sm:hidden">
                      <Needs needs={action.needs} holds={scenario.holds} />
                    </span>
                  </span>
                  <span className="hidden flex-wrap justify-end gap-1 sm:flex">
                    <Needs needs={action.needs} holds={scenario.holds} />
                  </span>
                  <span className={cn('flex items-center justify-end gap-1 text-sm font-semibold sm:justify-start', look.className)}>
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    {look.word}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <figcaption
        id={captionId}
        className="flex flex-col gap-1 border-t border-line bg-surface px-4 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-4 sm:px-6"
      >
        <span className="shrink-0 font-display font-semibold text-primary">Fig. 1</span>
        <span className="text-pretty">{scenario.caption}</span>
      </figcaption>
    </figure>
  );
}

/** The keys an action needs: filled when the actor holds that key, dashed when not. */
function Needs({ needs, holds }: { needs: readonly KeyId[]; holds: readonly KeyId[] }) {
  return (
    <>
      <span className="sr-only">Needs {needs.map((key) => KEY_NAME[key]).join(' and ')}.</span>
      {needs.map((key) => {
        const held = holds.includes(key);
        return (
          <span
            key={key}
            aria-hidden="true"
            className={cn(
              'inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-display text-xs font-medium whitespace-nowrap',
              key === 'main' && (held ? 'border-primary bg-primary text-on-primary' : 'border-dashed border-primary text-primary'),
              key === 'second' && (held ? 'border-accent bg-accent text-on-accent' : 'border-dashed border-accent-ink text-accent-ink'),
              key === 'new' && (held ? 'border-foreground bg-foreground text-background' : 'border-dashed border-muted text-muted'),
            )}
          >
            {key === 'new' ? <WalletIcon className="size-3" /> : <KeyRoundIcon className="size-3" />}
            {KEY_SHORT[key]}
          </span>
        );
      })}
    </>
  );
}

/** One path out of the box: a solid arrow when it opens, a dashed line stopped by a bar when it does not. */
function Arrow({ result }: { result: Result }) {
  const open = result === 'yes';
  return (
    <svg aria-hidden="true" viewBox="0 0 56 16" className="h-4 w-full overflow-visible">
      <line
        x1="0"
        y1="8"
        x2={open ? 46 : 30}
        y2="8"
        strokeWidth="2"
        className={cn('transition-colors', open ? 'stroke-primary' : result === 'later' ? 'stroke-accent dash-path' : 'stroke-line dash-path')}
      />
      {open ? (
        <path d="M44 3 L54 8 L44 13 Z" className="fill-primary" />
      ) : (
        <line x1="34" y1="1" x2="34" y2="15" strokeWidth="3" className={result === 'later' ? 'stroke-accent' : 'stroke-danger'} />
      )}
    </svg>
  );
}

const HOLDER_FILL = { you: 'fill-foreground', thief: 'fill-danger', lost: 'fill-muted' } as const;

/** The stake account as a strongbox, drawn flat-isometric. Each keyhole fills when the actor holds its key. */
function Strongbox({ scenario }: { scenario: Scenario }) {
  const mainHeld = scenario.holds.includes('main');
  const secondHeld = scenario.holds.includes('second');
  const rescue = scenario.holds.includes('new');
  // The lock stays shut for anyone with one key; only the rescue (all three) swings the stake out.
  const open = rescue;
  return (
    <svg
      role="img"
      aria-label={`A stake account drawn as a strongbox with two keyholes. Main key: ${scenario.holder.main.word}. Second key: ${scenario.holder.second.word}.`}
      viewBox="0 0 420 360"
      className="mx-auto h-auto w-full max-w-sm md:max-w-none"
    >
      {/* Dimension line: a drafting touch, the width of the box. */}
      <g className="stroke-line" strokeWidth="1">
        <line x1="40" y1="24" x2="260" y2="24" />
        <line x1="40" y1="18" x2="40" y2="30" />
        <line x1="260" y1="18" x2="260" y2="30" />
      </g>
      <text x="150" y="13" textAnchor="middle" className="fill-muted font-display text-sm">
        stake account
      </text>

      {/* Top and side faces. */}
      <polygon points="40,110 100,58 320,58 260,110" strokeWidth="2" className="fill-primary-soft stroke-primary" strokeLinejoin="round" />
      <polygon points="260,110 320,58 320,238 260,290" strokeWidth="2" className="fill-subtle stroke-primary" strokeLinejoin="round" />
      {/* SOL inside: coins on the lid, a hint of what the box holds. */}
      <g className="fill-surface stroke-primary" strokeWidth="1.5">
        <ellipse cx="170" cy="88" rx="26" ry="8" />
        <ellipse cx="170" cy="82" rx="26" ry="8" />
        <ellipse cx="170" cy="76" rx="26" ry="8" />
      </g>
      <text x="170" y="80" textAnchor="middle" className="fill-primary font-display text-xs font-semibold">
        SOL
      </text>

      {/* Front face. */}
      <rect x="40" y="110" width="220" height="180" strokeWidth="2" className="fill-surface stroke-primary" />
      <rect x="54" y="124" width="192" height="152" strokeWidth="1" className="fill-none stroke-line" />

      {/* Shackle between the keyholes: shut while the lock holds, raised for the rescue. */}
      <g className={cn('transition-transform', open ? '-translate-y-3' : 'translate-y-0')}>
        <path d="M134 162 V148 a16 16 0 0 1 32 0 V162" strokeWidth="5" className={cn('fill-none', open ? 'stroke-line' : 'stroke-primary')} strokeLinecap="round" />
      </g>
      <rect x="126" y="160" width="48" height="20" rx="3" className="fill-primary" />

      <Keyhole cx={92} cy={220} held={mainHeld} tone="main" />
      <Keyhole cx={208} cy={220} held={secondHeld} tone="second" />

      {/* Labels under the box. */}
      <text x="92" y="318" textAnchor="middle" className="fill-primary font-display text-lg font-semibold">
        Main key
      </text>
      <text x="92" y="344" textAnchor="middle" className={cn('font-display text-lg', HOLDER_FILL[scenario.holder.main.tone])}>
        {scenario.holder.main.word}
      </text>
      <text x="208" y="318" textAnchor="middle" className="fill-accent-ink font-display text-lg font-semibold">
        Second key
      </text>
      <text x="208" y="344" textAnchor="middle" className={cn('font-display text-lg', HOLDER_FILL[scenario.holder.second.tone])}>
        {scenario.holder.second.word}
      </text>

      {/* The new wallet: drawn in dashes until the rescue, then the stake's path out of the box reaches it. */}
      <g className={cn('transition-opacity', rescue ? 'opacity-100' : 'opacity-60')}>
        <line x1="322" y1="180" x2={rescue ? 352 : 344} y2="180" strokeWidth="2" className={rescue ? 'stroke-primary' : 'stroke-line dash-path'} />
        {rescue ? <path d="M350 174 L360 180 L350 186 Z" className="fill-primary" /> : null}
        <rect x="362" y="150" width="50" height="60" rx="4" strokeWidth="2" className={cn('fill-surface', rescue ? 'stroke-foreground' : 'stroke-line dash-path')} />
        <rect x="362" y="166" width="50" height="10" className={rescue ? 'fill-foreground' : 'fill-subtle'} />
        <text x="387" y="232" textAnchor="middle" className="fill-foreground font-display text-sm">
          New
        </text>
        <text x="387" y="250" textAnchor="middle" className="fill-foreground font-display text-sm">
          wallet
        </text>
      </g>
    </svg>
  );
}

function Keyhole({ cx, cy, held, tone }: { cx: number; cy: number; held: boolean; tone: 'main' | 'second' }) {
  const ring = tone === 'main' ? 'fill-primary stroke-primary' : 'fill-accent stroke-accent-ink';
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r="30"
        strokeWidth="2"
        className={cn('transition-colors', held ? ring : 'fill-surface stroke-line dash-path')}
      />
      <circle cx={cx} cy={cy - 7} r="8" className={held ? 'fill-surface' : 'fill-line'} />
      <polygon points={`${cx - 5},${cy - 2} ${cx + 5},${cy - 2} ${cx + 8},${cy + 16} ${cx - 8},${cy + 16}`} className={held ? 'fill-surface' : 'fill-line'} />
      {/* The key, in the hole: bow below, blade up into the slot. */}
      {held ? (
        <g className={tone === 'main' ? 'stroke-primary' : 'stroke-accent-ink'} strokeWidth="3" strokeLinecap="round">
          <line x1={cx} y1={cy + 8} x2={cx} y2={cy + 52} />
          <circle cx={cx} cy={cy + 62} r="9" className="fill-surface" />
        </g>
      ) : null}
    </g>
  );
}
