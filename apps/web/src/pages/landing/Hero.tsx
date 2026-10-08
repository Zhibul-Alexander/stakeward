import type { Cluster } from '@stakeward/core';
import { CheckIcon, GlobeIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { t, type MessageKey } from '@/i18n';
import { HashLink, Section } from './Section.tsx';

/** "On this page": each entry is named by its section's own title. */
const TOC: readonly (readonly [id: `#${string}`, title: MessageKey])[] = [
  ['#how-it-works', 'landing.how.title'],
  ['#protects', 'landing.protects.title'],
  ['#second-key', 'landing.secondKey.title'],
  ['#cannot-do', 'landing.cannotDo.title'],
  ['#fees', 'landing.fees.title'],
  ['#wallets', 'landing.wallets.title'],
  ['#alerts', 'landing.alerts.title'],
  ['#security', 'landing.security.title'],
  ['#recover', 'landing.recover.title'],
  ['#faq', 'faq.title'],
];

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/**
 * The top of the landing page: what Stakeward does, which network this site works on, the one primary action ("look
 * first", UX rule 1) and the table of contents.
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="flex flex-col gap-6">
      <div className="flex max-w-prose flex-col gap-4">
        <h1 id="landing-title" className="text-2xl font-semibold sm:text-3xl">
          {t('landing.title')}
        </h1>
        <p className="text-lg text-muted">{t('landing.lead')}</p>
      </div>
      <p data-slot="network" className="flex max-w-prose flex-wrap items-center gap-2 text-sm">
        <Badge tone={devnet ? 'warning' : 'outline'} className="text-sm">
          <GlobeIcon aria-hidden="true" />
          {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
        </Badge>
        <span>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/app">{t('landing.checkStake')}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href="#how-it-works">{t('landing.howItWorksLink')}</a>
          </Button>
        </div>
        <p className="max-w-prose text-sm text-muted">{t('landing.checkStakeHint')}</p>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {TRUST.map((key) => (
          <li key={key} className="flex items-start gap-2">
            <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <nav aria-labelledby="landing-toc" className="flex flex-col gap-2">
        <p id="landing-toc" className="text-sm font-semibold text-muted">
          {t('landing.toc.label')}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {TOC.map(([href, title]) => (
            <li key={href}>
              <HashLink href={href}>{t(title)}</HashLink>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}

/** Why a stake account needs a lock at all, before how Stakeward sets one. */
export function Why() {
  return (
    <Section id="why" title={t('landing.why.title')}>
      <div className="flex max-w-prose flex-col gap-3">
        <p>{t('landing.why.body1')}</p>
        <p>{t('landing.why.body2')}</p>
        <p>{t('landing.why.body3')}</p>
      </div>
    </Section>
  );
}
