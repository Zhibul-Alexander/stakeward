import { CircleAlertIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
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

/** Continue and Back of a protect wizard step, with the texts of its blockers (ContinueButtons). */
export function StepButtons({
  blockers,
  onContinue,
  onBack,
}: {
  blockers: readonly Blocker[];
  onContinue: () => void;
  onBack?: (() => void) | undefined;
}) {
  return <ContinueButtons problems={blockers.map(blockerText)} onContinue={onContinue} onBack={onBack} />;
}

/**
 * Continue and Back of a wizard step (UX rule 2: one main step per screen, Back keeps what was entered). Continue is
 * never disabled: pressed while something is missing (`problems`, the texts to show), it says what (inline, tied to
 * the button with aria-describedby) and moves focus to that text. The text goes away once the step is complete.
 */
export function ContinueButtons({
  problems,
  onContinue,
  onBack,
}: {
  problems: readonly string[];
  onContinue: () => void;
  onBack?: (() => void) | undefined;
}) {
  const [focusRequest, setFocusRequest] = useState(0);
  const errorId = useId();
  const errorRef = useRef<HTMLDivElement>(null);
  const shown = focusRequest > 0 && problems.length > 0;

  useEffect(() => {
    if (focusRequest > 0) errorRef.current?.focus();
  }, [focusRequest]);

  return (
    <div className="flex flex-col gap-3">
      {shown ? (
        <div
          id={errorId}
          ref={errorRef}
          tabIndex={-1}
          data-slot="step-blockers"
          className="flex items-start gap-2 rounded-md text-sm font-medium text-danger"
        >
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-1">
            {problems.map((problem) => (
              <p key={problem}>{problem}</p>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          aria-describedby={shown ? errorId : undefined}
          onClick={() => {
            if (problems.length > 0) setFocusRequest((value) => value + 1);
            else onContinue();
          }}
        >
          {t('common.continue')}
        </Button>
        {onBack === undefined ? null : (
          <Button variant="ghost" onClick={onBack}>
            {t('common.back')}
          </Button>
        )}
      </div>
    </div>
  );
}
