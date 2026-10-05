import { ArrowRightIcon, BlocksIcon, CoinsIcon, LockIcon, ShieldCheckIcon, SproutIcon, type LucideIcon } from 'lucide-react';
import { Fragment } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { t, type MessageKey } from '@/i18n';
import { PlusMark, RoleChip, type KeyRole } from './chips.tsx';

/** What Stakeward is, in four short claims (CLAUDE.md section 1: the pitch; section 2: non-custodial, no program, free). */
const FACTS: readonly { id: string; icon: LucideIcon; title: MessageKey; body: MessageKey }[] = [
  { id: 'non-custodial', icon: ShieldCheckIcon, title: 'landing.facts.nonCustodial.title', body: 'landing.facts.nonCustodial.body' },
  { id: 'no-program', icon: BlocksIcon, title: 'landing.facts.noProgram.title', body: 'landing.facts.noProgram.body' },
  { id: 'earning', icon: SproutIcon, title: 'landing.facts.earning.title', body: 'landing.facts.earning.body' },
  { id: 'free', icon: CoinsIcon, title: 'landing.facts.free.title', body: 'landing.facts.free.body' },
];

/**
 * Who must sign what while a lock holds (CLAUDE.md section 4, the stake program's rules): withdrawing and a new owner
 * need both keys, the lock answers to the second key alone, staking to the main key alone.
 */
const LOCK_RULES: readonly { action: MessageKey; roles: readonly KeyRole[] }[] = [
  { action: 'landing.lockCard.withdraw', roles: ['main', 'second'] },
  { action: 'landing.lockCard.newOwner', roles: ['main', 'second'] },
  { action: 'landing.lockCard.changeLock', roles: ['second'] },
  { action: 'landing.lockCard.staking', roles: ['main'] },
];

/** The top of the landing page: what Stakeward is, the one action (look at your stake, no wallet needed: UX rule 1). */
export function Hero() {
  return (
    <section aria-labelledby="landing-title" className="grid items-start gap-10 lg:grid-cols-5 lg:gap-12">
      <div className="flex flex-col gap-6 lg:col-span-3">
        <h1 id="landing-title" className="text-3xl font-semibold sm:text-4xl">
          {t('landing.title')}
        </h1>
        <p className="max-w-prose text-lg text-muted">{t('landing.lead')}</p>
        <div className="flex flex-col items-start gap-3">
          <Button asChild size="lg">
            <Link href="/app">
              {t('landing.checkStake')}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
          <p className="max-w-prose text-sm text-muted">{t('landing.checkStakeNote')}</p>
          <p className="flex items-start gap-2 text-sm font-medium">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            {t('common.neverSeedPhrase')}
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {FACTS.map(({ id, icon: Icon, title, body }) => (
            <li key={id} className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-subtle text-primary">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <p className="flex flex-col gap-0.5 text-sm">
                <span className="font-semibold">{t(title)}</span>
                <span className="text-muted">{t(body)}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
      <LockCard />
    </section>
  );
}

function LockCard() {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle asChild>
          <h2 className="flex items-center gap-2">
            <LockIcon aria-hidden="true" className="size-5 shrink-0 text-success" />
            {t('landing.lockCard.title')}
          </h2>
        </CardTitle>
        <CardDescription>{t('landing.lockCard.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col divide-y divide-border">
          {LOCK_RULES.map(({ action, roles }) => (
            <div key={action} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <dt className="text-sm font-medium">{t(action)}</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                {roles.map((role, index) => (
                  <Fragment key={role}>
                    {index === 0 ? null : (
                      <>
                        <PlusMark />
                        <span className="sr-only">{t('landing.lockCard.and')}</span>
                      </>
                    )}
                    <RoleChip role={role} />
                  </Fragment>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
