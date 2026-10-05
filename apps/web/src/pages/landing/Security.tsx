import { ShieldCheckIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { README_RECOVERY_URL, SOURCE_CODE_URL } from '@/config';
import { t, type Messages } from '@/i18n';
import { ExternalLink, Section } from './Section.tsx';

type SecurityItem = keyof Messages['landing']['security']['items'];

const ITEMS: readonly SecurityItem[] = ['chain', 'browser', 'summary', 'programs', 'server', 'site', 'data', 'open'];

/** How Stakeward keeps you safe (CLAUDE.md sections 2 and 11), with the source code to check it. */
export function Security() {
  return (
    <Section id="security" title={t('landing.security.title')}>
      <ul className="flex max-w-prose flex-col gap-3">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{t(`landing.security.items.${item}`)}</span>
          </li>
        ))}
      </ul>
      <p>
        <ExternalLink href={SOURCE_CODE_URL} label={t('landing.security.sourceLink')} />
      </p>
    </Section>
  );
}

/** If Stakeward disappears: the lock keeps working, and the recovery card and the README say how to act without it. */
export function Recover() {
  return (
    <Section id="recover" title={t('landing.recover.title')}>
      <div className="flex max-w-prose flex-col gap-3">
        <p>{t('landing.recover.body1')}</p>
        <p>{t('landing.recover.body2')}</p>
        <p>{t('landing.recover.body3')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* A long label: it wraps at 360 px instead of overflowing. */}
        <Button asChild variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal">
          <Link href="/app">{t('landing.recover.cardLink')}</Link>
        </Button>
        <ExternalLink href={README_RECOVERY_URL} label={t('landing.recover.guideLink')} />
      </div>
    </Section>
  );
}
