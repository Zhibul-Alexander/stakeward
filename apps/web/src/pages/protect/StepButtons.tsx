import { cn } from 'cn';
import { CircleAlertIcon, InfoIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ActionBar } from '@/components/product/action-bar';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { MAX_ACCOUNTS_PER_RUN, type Blocker } from './wizard.ts';

/** What the screen says when Continue cannot go on yet. */
export function blockerText(blocker: Blocker): string {
  switch (blocker) {
    case 'need-main':
      return t('protect.accounts.needMain');
    case 'need-one':
      return t('protect.accounts.needOne');
    case 'too-many':
      return t('protect.accounts.tooMany', { max: MAX_ACCOUNTS_PER_RUN });
    case 'none-left':
      return t('protect.accounts.noneLeft');
    case 'need-second':
      return t('protect.second.needSecond');
    case 'second-key-problem':
      return t('protect.second.fixProblem');
    case 'need-seed-check':
      return t('protect.second.needSeedCheck');
    case 'need-clock':
      return t('protect.period.needClock');
  }
}

/** The step button and Back of a protect wizard step, with the texts of its blockers (ContinueButtons). */
export function StepButtons({
  label,
  blockers,
  onContinue,
  onBack,
}: {
  label: string;
  blockers: readonly Blocker[];
  onContinue: () => void;
  onBack?: (() => void) | undefined;
}) {
  return <ContinueButtons label={label} problems={blockers.map(blockerText)} onContinue={onContinue} onBack={onBack} />;
}

/**
 * The step button and Back of a wizard step (UX rule 2: one main step per screen, Back keeps what was entered), in an
 * ActionBar. Ready, the step button is the screen's one filled button. While something is missing (`problems`, the
 * texts to show) it is outline with aria-disabled, and the first problem stands under it in muted text before any
 * click (the ActionBar's reason: under the button, above Back, below 640 px), tied to it with aria-describedby
 * (DECISIONS.md D109). It still takes clicks: pressed, the line names every problem in danger text and takes focus.
 * The line goes away once the step is complete.
 */
export function ContinueButtons({
  label,
  problems,
  onContinue,
  onBack,
}: {
  /** The step button's words: verb and object ("Continue with 2 accounts"). */
  label: string;
  problems: readonly string[];
  onContinue: () => void;
  onBack?: (() => void) | undefined;
}) {
  const [focusRequest, setFocusRequest] = useState(0);
  const reasonId = useId();
  const reasonRef = useRef<HTMLDivElement>(null);
  const blocked = problems.length > 0;
  const pressed = focusRequest > 0 && blocked;
  const shown = pressed ? problems : problems.slice(0, 1);

  useEffect(() => {
    if (focusRequest > 0) reasonRef.current?.focus();
  }, [focusRequest]);

  return (
    <ActionBar
      primary={
        <Button
          variant={blocked ? 'outline' : 'primary'}
          aria-disabled={blocked ? 'true' : undefined}
          aria-describedby={blocked ? reasonId : undefined}
          className="aria-disabled:pointer-events-auto aria-disabled:opacity-100"
          onClick={() => {
            if (blocked) setFocusRequest((value) => value + 1);
            else onContinue();
          }}
        >
          {label}
        </Button>
      }
      reason={
        blocked ? (
          <div
            id={reasonId}
            ref={reasonRef}
            tabIndex={-1}
            data-slot="step-blockers"
            data-pressed={pressed ? 'true' : 'false'}
            className={cn('flex items-start gap-2 rounded-md text-sm', pressed ? 'font-medium text-danger' : 'text-muted')}
          >
            {pressed ? (
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            ) : (
              <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            )}
            <div className="flex flex-col gap-1">
              {shown.map((problem) => (
                <p key={problem}>{problem}</p>
              ))}
            </div>
          </div>
        ) : undefined
      }
      secondary={
        onBack === undefined ? undefined : (
          <Button variant="ghost" onClick={onBack}>
            {t('common.back')}
          </Button>
        )
      }
    />
  );
}
