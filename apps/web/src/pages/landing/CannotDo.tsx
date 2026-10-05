import {
  CalendarClockIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  HourglassIcon,
  KeyIcon,
  KeyRoundIcon,
  ShieldOffIcon,
  SnowflakeIcon,
  Undo2Icon,
  type LucideIcon,
} from 'lucide-react';
import { t, type MessageKey } from '@/i18n';

/**
 * The honest limits (CLAUDE.md section 1 "Честное ограничение", section 4 "Итог"). They say what README.md "What no one
 * can undo" says: change one, change the other.
 */
const LIMITS: readonly { id: string; icon: LucideIcon; title: MessageKey; body: MessageKey }[] = [
  { id: 'freeze', icon: SnowflakeIcon, title: 'landing.cannotDo.freeze.title', body: 'landing.cannotDo.freeze.body' },
  { id: 'lose-second', icon: HourglassIcon, title: 'landing.cannotDo.loseSecond.title', body: 'landing.cannotDo.loseSecond.body' },
  { id: 'not-backup', icon: KeyRoundIcon, title: 'landing.cannotDo.notBackup.title', body: 'landing.cannotDo.notBackup.body' },
  { id: 'staking', icon: CircleAlertIcon, title: 'landing.cannotDo.staking.title', body: 'landing.cannotDo.staking.body' },
  { id: 'lock-ends', icon: CalendarClockIcon, title: 'landing.cannotDo.lockEnds.title', body: 'landing.cannotDo.lockEnds.body' },
  { id: 'both-keys', icon: KeyIcon, title: 'landing.cannotDo.bothKeys.title', body: 'landing.cannotDo.bothKeys.body' },
  { id: 'one-seed', icon: ShieldOffIcon, title: 'landing.cannotDo.oneSeed.title', body: 'landing.cannotDo.oneSeed.body' },
  { id: 'no-recovery', icon: Undo2Icon, title: 'landing.cannotDo.noRecovery.title', body: 'landing.cannotDo.noRecovery.body' },
];

/** Out of scope (CLAUDE.md section 1 "Вне рамок"). */
const NOT_COVERED: readonly MessageKey[] = [
  'landing.cannotDo.notCovered.lst',
  'landing.cannotDo.notCovered.exchange',
  'landing.cannotDo.notCovered.vote',
  'landing.cannotDo.notCovered.balance',
];

/** "What Stakeward cannot do": every footer links here (/#cannot-do, UX rule 12), so the id stays. */
export function CannotDo() {
  return (
    <section id="cannot-do" aria-labelledby="cannot-do-title" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="cannot-do-title" className="text-2xl font-semibold">
          {t('landing.cannotDo.title')}
        </h2>
        <p className="max-w-prose text-muted">{t('landing.cannotDo.intro')}</p>
      </div>
      <ul className="grid gap-4 md:grid-cols-2">
        {LIMITS.map(({ id, icon: Icon, title, body }) => (
          <li key={id} data-limit={id} className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4">
            <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
            <p className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">{t(title)}</span>
              <span className="text-muted">{t(body)}</span>
            </p>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{t('landing.cannotDo.notCovered.title')}</h3>
        <p className="max-w-prose text-muted">{t('landing.cannotDo.notCovered.intro')}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {NOT_COVERED.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <CircleSlashIcon aria-hidden="true" className="size-4 shrink-0 text-muted" />
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
