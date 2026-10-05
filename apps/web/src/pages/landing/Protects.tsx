import { KeyRoundIcon, LockIcon, ShieldCheckIcon, ShieldOffIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { RiskNote } from '@/components/product/risk-note';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t, type MessageKey } from '@/i18n';
import { HashLink, PageLink, Section } from './Section.tsx';

function TitledCard({ icon: Icon, title, level, children }: { icon: LucideIcon; title: string; level: 'h3' | 'h4'; children: ReactNode }) {
  const Heading = level;
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <Heading className="flex items-center gap-2">
            <Icon aria-hidden="true" className="size-5 shrink-0 text-muted" />
            {title}
          </Heading>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">{children}</CardContent>
    </Card>
  );
}

function BulletList({ keys }: { keys: readonly MessageKey[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {keys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  );
}

/** What Stakeward covers and what not, and what the lock stops while it holds (CLAUDE.md sections 1 and 4). */
export function Protects() {
  return (
    <Section id="protects" title={t('landing.protects.title')}>
      <div className="grid gap-4 md:grid-cols-2">
        <TitledCard icon={ShieldCheckIcon} title={t('landing.protects.coveredTitle')} level="h3">
          <p>{t('landing.protects.covered')}</p>
          <p className="text-muted">
            {t('landing.protects.coveredHint')} <PageLink href="/app">{t('landing.protects.coveredLink')}</PageLink>
          </p>
        </TitledCard>
        <TitledCard icon={ShieldOffIcon} title={t('landing.protects.notCoveredTitle')} level="h3">
          <BulletList
            keys={[
              'landing.protects.notCovered.lst',
              'landing.protects.notCovered.exchange',
              'landing.protects.notCovered.balance',
              'landing.protects.notCovered.vote',
            ]}
          />
        </TitledCard>
      </div>
      <h3 className="text-lg font-semibold">{t('landing.protects.lockTitle')}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <TitledCard icon={LockIcon} title={t('landing.protects.needsSecondTitle')} level="h4">
          <BulletList keys={['landing.protects.needsSecond.withdraw', 'landing.protects.needsSecond.owner']} />
          <p>{t('landing.protects.lockOnlySecond')}</p>
        </TitledCard>
        <TitledCard icon={KeyRoundIcon} title={t('landing.protects.mainAloneTitle')} level="h4">
          <BulletList
            keys={[
              'landing.protects.mainAlone.deactivate',
              'landing.protects.mainAlone.redelegate',
              'landing.protects.mainAlone.split',
              'landing.protects.mainAlone.manager',
            ]}
          />
        </TitledCard>
      </div>
      <p className="max-w-prose">{t('landing.protects.thief')}</p>
    </Section>
  );
}

/** The honest limit of the product, said before anyone picks a second key (CLAUDE.md section 1). */
export function SecondKey() {
  return (
    <Section id="second-key" title={t('landing.secondKey.title')}>
      <RiskNote risk="second-key-can-freeze" className="max-w-prose">
        <p>{t('landing.secondKey.freeze')}</p>
      </RiskNote>
      <ul className="flex max-w-prose list-disc flex-col gap-2 pl-5">
        <li>{t('landing.secondKey.differentSeed')}</li>
        <li>{t('landing.secondKey.apart')}</li>
        <li>{t('landing.secondKey.lost')}</li>
        <li>{t('landing.secondKey.stolen')}</li>
      </ul>
      <p>
        <HashLink href="#faq-good-second-key">{t('landing.secondKey.more')}</HashLink>
      </p>
    </Section>
  );
}
