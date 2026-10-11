import { cn } from 'cn';
import { BellRingIcon, ChevronRightIcon, CircleHelpIcon, CoinsIcon, ShieldIcon, WalletIcon, type LucideIcon } from 'lucide-react';
import { Link } from 'wouter';
import { t } from '@/i18n';
import { LEARN_TABS, type LearnTab } from '../LearnPage.tsx';

const LOOK: Record<LearnTab, { icon: LucideIcon; tile: string }> = {
  faq: { icon: CircleHelpIcon, tile: 'bg-lilac text-lilac-ink' },
  alerts: { icon: BellRingIcon, tile: 'bg-sky text-sky-ink' },
  costs: { icon: CoinsIcon, tile: 'bg-peach text-peach-ink' },
  wallets: { icon: WalletIcon, tile: 'bg-mint text-mint-ink' },
  safety: { icon: ShieldIcon, tile: 'bg-lilac text-lilac-ink' },
};

/** The way from the short landing page to the details (/learn): one friendly tile per tab. */
export function LearnMore() {
  return (
    <section aria-labelledby="learn-more-title" className="flex flex-col gap-4 sm:gap-6">
      <h2 id="learn-more-title" className="text-2xl text-balance">
        {t('landing.learnMore.title')}
      </h2>
      <ul role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LEARN_TABS.map((id) => {
          const { icon: Icon, tile } = LOOK[id];
          return (
            <li key={id}>
              <Link
                href={`/learn/${id}`}
                className="group flex h-full items-center gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <span aria-hidden="true" className={cn('flex size-12 shrink-0 items-center justify-center rounded-lg', tile)}>
                  <Icon className="size-6" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-base font-bold">{t(`learn.tabs.${id}`)}</span>
                  <span className="text-sm text-muted">{t(`landing.learnMore.${id}`)}</span>
                </span>
                <ChevronRightIcon aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
