import type { Address } from '@solana/kit';
import type { Cluster } from '@stakeward/core';
import {
  BellRingIcon,
  CalendarClockIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GlobeIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  PlayIcon,
  type LucideIcon,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';
import { AddressForm } from '@/pages/app/AddressForm';
import { ScoreGauge } from '../../components/product/score-gauge.tsx';

type Item = {
  icon: LucideIcon;
  title: string;
  response: string;
  guards: string;
  /** Who can tick it: the network (read by Stakeward) or only you. */
  by: 'network' | 'you';
};

/** The five items of the pre-flight checklist, each with the attack it closes. Illustrative here: nothing is ticked. */
const ITEMS: readonly Item[] = [
  {
    icon: LockKeyholeIcon,
    title: 'Your stake is locked by a second key',
    response: 'Locked',
    guards: 'A stolen main key withdrawing your SOL, or quietly signing it over to a thief.',
    by: 'network',
  },
  {
    icon: KeyRoundIcon,
    title: 'The second key comes from another seed phrase',
    response: 'Separate',
    guards: 'One leaked seed phrase opening both keys at once.',
    by: 'you',
  },
  {
    icon: BellRingIcon,
    title: 'Telegram alerts are on',
    response: 'On',
    guards: 'A thief unstaking, moving or splitting your stake without you noticing.',
    by: 'you',
  },
  {
    icon: CalendarClockIcon,
    title: 'The lock does not end soon',
    response: '30+ days',
    guards: 'Protection lapsing quietly while the main key may already be in the wrong hands.',
    by: 'network',
  },
  {
    icon: FileTextIcon,
    title: 'The recovery card is printed',
    response: 'Printed',
    guards: 'Being stuck if Stakeward is ever offline: the card lists Solana CLI commands that work without it.',
    by: 'you',
  },
];

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/**
 * The top of the landing page (v8, "pre-flight checklist"): the claim, then the checklist itself as the hero, beside an
 * empty score gauge that takes a wallet address. The checklist is illustrative (no box is ticked); the real one runs on
 * /app from the network.
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  const [, navigate] = useLocation();
  const show = (address: Address) => {
    navigate(`/app?address=${address}`);
  };
  return (
    <section aria-labelledby="landing-title" className="flex flex-col gap-8 sm:gap-10">
      <div className="flex max-w-3xl flex-col gap-4">
        <p data-slot="network" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:text-sm">
          <Badge tone="outline">
            <GlobeIcon aria-hidden="true" />
            {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
          </Badge>
          <span className={devnet ? 'md:hidden' : undefined}>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
        </p>
        <h1 id="landing-title" className="text-3xl text-balance sm:text-4xl">
          {t('landing.title')}
        </h1>
        <p className="max-w-2xl text-base text-pretty text-muted sm:text-lg">{t('landing.lead')}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* The gauge card: first on a phone, right of the checklist from 1024 px, and it stays in view while the list scrolls. */}
        <aside
          aria-labelledby="score-title"
          className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5 shadow-md lg:sticky lg:top-6 lg:order-2 lg:col-span-5 lg:p-6"
        >
          <div className="flex items-center gap-4 sm:gap-6">
            <ScoreGauge className="w-32 shrink-0 sm:w-44" />
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id="score-title" className="text-lg font-semibold text-balance">
                Your score
              </h2>
              <p className="text-sm text-pretty text-muted">Paste a wallet to get your score: the share of scored checks your stake passes, read from the network.</p>
            </div>
          </div>
          <AddressForm value="" onSubmit={show} />
          <p className="text-sm text-muted">{t('landing.checkStakeHint')}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
            <Button asChild variant="outline">
              <Link href="/protect">{t('landing.protectStake')}</Link>
            </Button>
            <Button asChild variant="link" className="px-0">
              <Link href="/demo">
                <PlayIcon aria-hidden="true" />
                {t('landing.demoLink')}
              </Link>
            </Button>
          </div>
        </aside>

        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-md lg:order-1 lg:col-span-7">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-band px-4 py-3 text-on-band sm:px-6">
            <h2 className="text-base font-semibold">Stake pre-flight checklist</h2>
            <p className="font-mono text-xs text-band-muted">5 items, none ticked yet</p>
          </div>
          <ol role="list" className="divide-y divide-border">
            {ITEMS.map((item, index) => (
              <ChecklistLine key={item.title} item={item} number={index + 1} />
            ))}
          </ol>
          <p className="border-t border-border bg-subtle px-4 py-3 text-xs text-muted sm:px-6">
            Items read from the network are ticked for you on the accounts page. The others only you can confirm; the checklist reminds you.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {TRUST.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm bg-done text-xs leading-none text-surface">
                ✓
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
        {devnet ? (
          <Button asChild variant="link" className="w-fit">
            <a href={MAINNET_SITE_URL}>
              <GlobeIcon aria-hidden="true" />
              {t('landing.tryMainnet')}
            </a>
          </Button>
        ) : (
          <Button asChild variant="link" className="w-fit">
            <a href={TESTNET_SITE_URL}>
              <FlaskConicalIcon aria-hidden="true" />
              {t('landing.tryTestnet')}
            </a>
          </Button>
        )}
      </div>
    </section>
  );
}

function ChecklistLine({ item, number }: { item: Item; number: number }) {
  const Icon = item.icon;
  return (
    <li className="grid grid-cols-[1.5rem_auto_minmax(0,1fr)] gap-x-3 px-4 py-4 sm:grid-cols-[2rem_auto_minmax(0,1fr)] sm:gap-x-4 sm:px-6">
      <span className="pt-0.5 font-mono text-sm text-muted tabular-nums">{String(number).padStart(2, '0')}</span>
      {/* An empty amber tick box: still to do. */}
      <span aria-hidden="true" className="mt-0.5 size-5 rounded-sm border-2 border-todo bg-surface" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex items-end gap-2">
          <span className="font-medium text-pretty">{item.title}</span>
          <span aria-hidden="true" className="leader hidden sm:block" />
          <span className="hidden shrink-0 font-mono text-sm text-foreground sm:inline">{item.response}</span>
        </p>
        <p className="flex gap-2 text-sm text-pretty text-muted">
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-medium text-foreground">Guards against </span>
            {item.guards.charAt(0).toLowerCase() + item.guards.slice(1)}
          </span>
        </p>
        <p className="text-xs text-muted">{item.by === 'network' ? 'Read from the network' : 'You confirm this one'}</p>
      </div>
    </li>
  );
}
