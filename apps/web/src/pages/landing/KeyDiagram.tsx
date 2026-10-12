import { lockupEndForPeriod } from '@stakeward/core';
import { cn } from 'cn';
import { BanIcon, CalendarClockIcon, CheckIcon, ClockIcon, KeyRoundIcon, ShieldCheckIcon, TriangleAlertIcon, WalletIcon, type LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { formatDate, formatList, t, type MessageKey } from '@/i18n';

/**
 * The landing's one figure (D145): one stake account drawn as a box, what each key can do with it, and who holds which
 * key in four cases. The drawing has no words (translations stay out of the SVG, so nothing overlaps it at any width
 * or in any language); the legend under it and the list beside it are real text, so a screen reader hears the answer.
 *
 * The rules are CLAUDE.md section 4, while the lock holds:
 * - Withdraw and a new withdraw key (Authorize Withdrawer) need the main key and the second key (custodian).
 * - The lock itself (date, second key) is changed by the second key alone; the main key cannot touch it.
 * - Stop staking (Deactivate), move to another validator (Delegate), split and a new staking key (Authorize Staker)
 *   need only the main key.
 * - Rescue: main key + second key + the new wallet sign together; both roles move to the new wallet, the lock and its
 *   date stay as they were.
 * After the end date the main key alone withdraws, hands the stake over and sets a new lock again.
 *
 * In the drawing the main key opens the box's door and the second key the padlock on it; the tag on the padlock is
 * the end date. Each keyhole is filled in its holder's colour (you: the key's own colour, thief: danger, lost: dashed),
 * and only what changes between cases moves: the keyholes, the date tag, the path to the new wallet.
 */

type KeyId = 'main' | 'second' | 'new';
type ScenarioId = 'thief' | 'lost' | 'secondStolen' | 'rescue';
type Holder = 'you' | 'thief' | 'lost';
type Result = 'yes' | 'no' | 'later';
type LockState = 'holds' | 'wait' | 'anyDate' | 'unchanged';

type Scenario = {
  id: ScenarioId;
  /** The keys of whoever acts in this case. */
  holds: readonly KeyId[];
  holder: Record<'main' | 'second', Holder>;
  lock: LockState;
};

const SCENARIOS: readonly [Scenario, ...Scenario[]] = [
  { id: 'thief', holds: ['main'], holder: { main: 'thief', second: 'you' }, lock: 'holds' },
  { id: 'lost', holds: ['main'], holder: { main: 'you', second: 'lost' }, lock: 'wait' },
  { id: 'secondStolen', holds: ['second'], holder: { main: 'you', second: 'thief' }, lock: 'anyDate' },
  { id: 'rescue', holds: ['main', 'second', 'new'], holder: { main: 'you', second: 'you' }, lock: 'unchanged' },
];

type Action = { id: string; label: MessageKey; needs: readonly KeyId[]; afterDate: boolean };

/** afterDate: the main key alone (with a new wallet for the rescue) can do it once the end date has passed. */
const ACTIONS: readonly Action[] = [
  { id: 'withdraw', label: 'landing.protects.needsSecond.withdraw', needs: ['main', 'second'], afterDate: true },
  { id: 'owner', label: 'landing.protects.needsSecond.owner', needs: ['main', 'second'], afterDate: true },
  { id: 'lock', label: 'landing.protects.needsSecond.lock', needs: ['second'], afterDate: true },
  { id: 'deactivate', label: 'landing.protects.mainAlone.deactivate', needs: ['main'], afterDate: false },
  { id: 'redelegate', label: 'landing.protects.mainAlone.redelegate', needs: ['main'], afterDate: false },
  { id: 'split', label: 'landing.protects.mainAlone.split', needs: ['main'], afterDate: false },
  { id: 'manager', label: 'landing.protects.mainAlone.manager', needs: ['main'], afterDate: false },
  { id: 'rescue', label: 'landing.diagram.rescueAction', needs: ['main', 'second', 'new'], afterDate: true },
];

const WORD: Record<Result, MessageKey> = {
  yes: 'landing.diagram.result.yes',
  no: 'landing.diagram.result.no',
  later: 'landing.diagram.result.later',
};

/**
 * What an answer means for the owner of the stake, and so its colour and icon: what a thief can do is a warning, what
 * a thief cannot do is good news (the lock at work), and what you can do is good news. A green tick never stands next
 * to a thief's power. The word (Can, Cannot, After the date) stays the same.
 */
type Outcome = 'good' | 'bad' | 'wait';

const OUTCOME: Record<Outcome, { className: string }> = {
  good: { className: 'text-success' },
  bad: { className: 'text-warning' },
  wait: { className: 'text-accent-ink' },
};

function outcomeOf(scenario: Scenario, result: Result): Outcome {
  if (result === 'later') return 'wait';
  const thief = scenario.holder.main === 'thief' || scenario.holder.second === 'thief';
  return (result === 'yes') === thief ? 'bad' : 'good';
}

function iconOf(result: Result, outcome: Outcome): LucideIcon {
  if (result === 'later') return ClockIcon;
  if (result === 'yes') return outcome === 'good' ? CheckIcon : TriangleAlertIcon;
  return outcome === 'good' ? ShieldCheckIcon : BanIcon;
}

const HOLDER_TEXT: Record<Holder, string> = { you: 'text-foreground', thief: 'text-danger', lost: 'text-muted' };

function resultOf(scenario: Scenario, action: Action): Result {
  if (action.needs.every((key) => scenario.holds.includes(key))) return 'yes';
  // Only the case where the second key is gone waits for the date; a thief with one key stays stopped.
  if (scenario.id === 'lost' && action.afterDate) return 'later';
  return 'no';
}

export function KeyDiagram() {
  const [state, setState] = useState<{ current: ScenarioId; previous: ScenarioId | null }>({ current: 'thief', previous: null });
  const scenario = SCENARIOS.find((item) => item.id === state.current) ?? SCENARIOS[0];
  const previous = SCENARIOS.find((item) => item.id === state.previous);
  const name = useId();
  const captionId = useId();
  // An example end date: a 6-month lock started today (the default period, CLAUDE.md section 5). The instant is fixed
  // once; it is formatted on every render so a language switch rewrites it in that language.
  const [end] = useState(() => lockupEndForPeriod(new Date(), 6));
  const until = formatDate(end) ?? '';
  const can = ACTIONS.filter((action) => resultOf(scenario, action) === 'yes').length;

  return (
    <figure id="protects" aria-labelledby={captionId} data-slot="key-diagram" className="scroll-mt-4 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
      <fieldset className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:px-6">
        <legend className="sr-only">{t('landing.diagram.pick')}</legend>
        <p aria-hidden="true" className="font-display text-sm font-medium text-muted">
          {t('landing.diagram.pick')}
        </p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {SCENARIOS.map((item) => (
            <label
              key={item.id}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-center font-display text-sm font-medium text-balance transition-colors',
                'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
                item.id === scenario.id ? 'border-primary bg-primary-soft text-foreground' : 'border-border-strong bg-surface text-foreground hover:bg-subtle',
              )}
            >
              <input
                type="radio"
                name={name}
                value={item.id}
                checked={item.id === scenario.id}
                onChange={() => {
                  setState((value) => ({ current: item.id, previous: value.current }));
                }}
                className="sr-only"
              />
              {t(`landing.diagram.scenarios.${item.id}.label`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-12 md:gap-8">
        <div className="flex flex-col gap-4 md:col-span-5">
          <StakeBox scenario={scenario} />
          <Legend scenario={scenario} until={until} />
        </div>

        <div className="flex min-w-0 flex-col gap-3 md:col-span-7">
          <p aria-live="polite" className="font-display text-base font-semibold text-pretty">
            {t(`landing.diagram.scenarios.${scenario.id}.who`)}
            <span className="sr-only"> {t('landing.diagram.canCount', { can, total: ACTIONS.length })}</span>
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {ACTIONS.map((action) => {
              const result = resultOf(scenario, action);
              const changed = previous !== undefined && resultOf(previous, action) !== result;
              const outcome = outcomeOf(scenario, result);
              const Icon = iconOf(result, outcome);
              return (
                <li key={action.id} data-action={action.id} data-result={result} data-outcome={outcome} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  {/* The action, and under it the keys it needs: the rule that decides the answer, shown with it. */}
                  <span className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-sm font-medium text-pretty">{t(action.label)}</span>
                    <span className="flex flex-wrap gap-1">
                      <Needs needs={action.needs} holds={scenario.holds} />
                    </span>
                  </span>
                  {/* Remounted when its answer changes, so only a changed answer moves (D142: motion answers the click). */}
                  <span
                    key={changed ? `${scenario.id}-${result}` : `${result}-${outcome}`}
                    data-slot="answer"
                    className={cn('flex max-w-32 shrink-0 items-start justify-end gap-1 text-right text-sm font-semibold sm:max-w-none', OUTCOME[outcome].className, changed && 'animate-pop-in')}
                  >
                    <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    {t(WORD[result])}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <figcaption id={captionId} className="border-t border-line px-4 py-3 text-sm text-pretty sm:px-6">
        {t(`landing.diagram.scenarios.${scenario.id}.caption`)}
      </figcaption>
    </figure>
  );
}

/** The keys an action needs: a solid frame on its tint when whoever acts holds that key, dashed when not. */
function Needs({ needs, holds }: { needs: readonly KeyId[]; holds: readonly KeyId[] }) {
  return (
    <>
      <span className="sr-only">{t('landing.diagram.needs', { keys: formatList(needs.map((key) => t(`common.roles.${key}`))) })}</span>
      {needs.map((key) => {
        const held = holds.includes(key);
        const Icon = key === 'new' ? WalletIcon : KeyRoundIcon;
        return (
          <span
            key={key}
            aria-hidden="true"
            className={cn(
              'inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-display text-xs font-medium whitespace-nowrap',
              key === 'main' && (held ? 'border-primary bg-primary-soft text-foreground' : 'border-dashed border-primary text-primary'),
              key === 'second' && (held ? 'border-accent-ink bg-accent-soft text-foreground' : 'border-dashed border-accent-ink text-accent-ink'),
              key === 'new' && (held ? 'border-foreground bg-subtle text-foreground' : 'border-dashed border-muted text-muted'),
            )}
          >
            <Icon className="size-3" />
            {t(`common.roles.${key}`)}
          </span>
        );
      })}
    </>
  );
}

/** The drawing's words: who holds each key, the lock's date, the new wallet. */
function Legend({ scenario, until }: { scenario: Scenario; until: string }) {
  const rescue = scenario.id === 'rescue';
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {(['main', 'second'] as const).map((key) => {
        const holder = scenario.holder[key];
        return (
          <div key={key} data-key={key} data-holder={holder} className="flex min-w-0 flex-col">
            <dt className="flex items-center gap-1.5 font-display font-medium">
              <KeyRoundIcon aria-hidden="true" className={cn('size-4 shrink-0', key === 'main' ? 'text-primary' : 'text-accent-ink')} />
              {t(`common.roles.${key}`)}
            </dt>
            <dd className={cn('pl-5.5 font-semibold', HOLDER_TEXT[holder])}>{t(`landing.diagram.holder.${holder}`)}</dd>
          </div>
        );
      })}
      <div data-key="lock" data-lock={scenario.lock} className="flex min-w-0 flex-col">
        <dt className="flex items-center gap-1.5 font-display font-medium">
          <CalendarClockIcon aria-hidden="true" className="size-4 shrink-0 text-accent-ink" />
          {t('landing.diagram.lock.label')}
        </dt>
        <dd className={cn('pl-5.5 text-pretty', scenario.lock === 'anyDate' ? 'font-semibold text-danger' : 'text-foreground')}>
          {t(`landing.diagram.lock.${scenario.lock}`, { date: until })}
        </dd>
      </div>
      <div data-key="new" className="flex min-w-0 flex-col">
        <dt className="flex items-center gap-1.5 font-display font-medium">
          <WalletIcon aria-hidden="true" className="size-4 shrink-0 text-foreground" />
          {t('common.roles.new')}
        </dt>
        <dd className={cn('pl-5.5 text-pretty', rescue ? 'font-semibold text-foreground' : 'text-muted')}>
          {t(rescue ? 'landing.diagram.newWallet.rescue' : 'landing.diagram.newWallet.idle')}
        </dd>
      </div>
    </dl>
  );
}

/*
 * The box in 2:1 isometric (the pixel-art projection: every receding edge rises one unit per two across, so its pixels
 * step evenly). Front-bottom corner F (120,220); the right face runs 128 across and 64 up, the left face 72 across and
 * 36 up, the height is 104. The right face carries the door; its parts are drawn flat in face coordinates (u along the
 * face, v down) and mapped onto it by FACE, with strokes that do not scale, so every line keeps one weight.
 */
const FACE = 'matrix(1 -0.5 0 1 120 116)';
const STROKE = 2;
const DETAIL = 1.5;

const KEYHOLE: Record<Holder, Record<'main' | 'second', string>> = {
  you: { main: 'fill-primary stroke-primary', second: 'fill-accent stroke-accent-ink' },
  thief: { main: 'fill-danger stroke-danger', second: 'fill-danger stroke-danger' },
  lost: { main: 'fill-surface stroke-muted dash-path', second: 'fill-surface stroke-muted dash-path' },
};

/** The cut of a keyhole: the ground showing through a held key's fill, or the outline's colour when the key is lost. */
const SLOT: Record<Holder, Record<'main' | 'second', string>> = {
  you: { main: 'fill-surface', second: 'fill-on-accent' },
  thief: { main: 'fill-surface', second: 'fill-surface' },
  lost: { main: 'fill-muted', second: 'fill-muted' },
};

function StakeBox({ scenario }: { scenario: Scenario }) {
  const rescue = scenario.id === 'rescue';
  const main = scenario.holder.main;
  const second = scenario.holder.second;
  return (
    <svg aria-hidden="true" viewBox="36 8 348 220" className="mx-auto h-auto w-full max-w-sm md:max-w-none" strokeLinejoin="round" strokeLinecap="round">
      {/* Top, left and right faces. */}
      <polygon points="48,80 120,116 248,52 176,16" strokeWidth={STROKE} className="fill-primary-soft stroke-primary" />
      <polygon points="48,184 48,80 120,116 120,220" strokeWidth={STROKE} className="fill-subtle stroke-primary" />
      <polygon points="120,220 120,116 248,52 248,156" strokeWidth={STROKE} className="fill-surface stroke-primary" />

      {/* The door on the right face, and the main key's keyhole in it. */}
      <g transform={FACE}>
        <rect x="12" y="14" width="104" height="78" rx="2" strokeWidth={DETAIL} vectorEffect="non-scaling-stroke" className="fill-none stroke-line" />
        <circle cx="36" cy="52" r="13" strokeWidth={STROKE} vectorEffect="non-scaling-stroke" className={cn('transition-colors', KEYHOLE[main].main)} />
        <circle cx="36" cy="48" r="4" className={SLOT[main].main} />
        <polygon points="34,50 38,50 40,60 32,60" className={SLOT[main].main} />
        {/* The staple the padlock hangs from. */}
        <rect x="86" y="20" width="8" height="10" rx="1" strokeWidth={DETAIL} vectorEffect="non-scaling-stroke" className="fill-subtle stroke-primary" />
      </g>

      {/* The padlock (the lock, opened only by the second key while it holds), drawn upright as it hangs. */}
      <path d="M201 112 V103 a9 9 0 0 1 18 0 V112" strokeWidth={3} className="fill-none stroke-accent-ink" />
      <rect x="194" y="110" width="32" height="26" rx="3" strokeWidth={STROKE} className="fill-accent-soft stroke-accent-ink" />
      <circle cx="210" cy="123" r="7" strokeWidth={DETAIL} className={cn('transition-colors', KEYHOLE[second].second)} />
      <rect x="209" y="120" width="2" height="6" rx="1" className={SLOT[second].second} />

      {/* The end-date tag. A thief with the second key can move the date: the tag swings off its place, which stays dashed. */}
      {scenario.lock === 'anyDate' ? (
        <g strokeWidth={DETAIL} className="fill-none stroke-muted dash-path">
          <path d="M210 136 V146" />
          <rect x="192" y="146" width="36" height="20" rx="3" />
        </g>
      ) : null}
      <g className={cn('origin-top transform-fill transition-transform', scenario.lock === 'anyDate' && '-rotate-12')}>
        <path d="M210 136 V146" strokeWidth={DETAIL} className="fill-none stroke-accent-ink" />
        <rect
          x="192"
          y="146"
          width="36"
          height="20"
          rx="3"
          strokeWidth={STROKE}
          className={cn('transition-colors', scenario.lock === 'anyDate' ? 'fill-danger-soft stroke-danger' : scenario.lock === 'wait' ? 'fill-accent stroke-accent-ink' : 'fill-surface stroke-accent-ink')}
        />
        <circle cx="198" cy="156" r="2" className="fill-accent-ink" />
        <path d="M204 152 H222 M204 160 H216" strokeWidth={DETAIL} className={scenario.lock === 'anyDate' ? 'stroke-danger' : 'stroke-accent-ink'} />
      </g>

      {/* The new wallet: drawn dashed until the rescue hands it the stake account. */}
      <g className="transition-opacity">
        <path d="M260 150 H292" strokeWidth={STROKE} className={rescue ? 'stroke-foreground' : 'stroke-line dash-path'} />
        {rescue ? <polygon points="290,144 300,150 290,156" className="fill-foreground" /> : null}
        <rect x="308" y="126" width="68" height="48" rx="4" strokeWidth={STROKE} className={cn('fill-surface', rescue ? 'stroke-foreground' : 'stroke-line dash-path')} />
        <rect x="348" y="140" width="28" height="20" rx="3" strokeWidth={DETAIL} className={cn('fill-subtle', rescue ? 'stroke-foreground' : 'stroke-line dash-path')} />
        <circle cx="358" cy="150" r="3" className={rescue ? 'fill-foreground' : 'fill-line'} />
      </g>
    </svg>
  );
}
