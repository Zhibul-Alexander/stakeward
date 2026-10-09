import { ShieldCheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { README_RECOVERY_URL, SOURCE_CODE_URL } from '@/config';
import { t, type Messages } from '@/i18n';
import { ExternalLink, HashLink, PageLink, Section, SubSection } from './Section.tsx';

type SecurityItem = keyof Messages['landing']['security']['items'];

/** `site` follows `server` (the same server delivers this website), and each item stands alone in either column. */
const ITEMS: readonly SecurityItem[] = ['chain', 'browser', 'server', 'site', 'programs', 'open'];

/** The separator between two links of the row from 640 px: for the eye only. Below, the links stand one per line. */
function Dot() {
  return (
    <span aria-hidden="true" className="hidden pr-1 pl-2 text-muted sm:inline">
      ·
    </span>
  );
}

/**
 * One link of the recovery links: one per line on a phone; from 640 px a row that flows like a sentence. Each link with
 * its dot never breaks inside, so a line ends between two links (the space after the dot).
 */
function RecoverLink({ children, last = false }: { children: ReactNode; last?: boolean }) {
  return (
    <li className="sm:inline">
      <span className="whitespace-nowrap">
        {children}
        {last ? null : <Dot />}
      </span>{' '}
    </li>
  );
}

/**
 * How Stakeward keeps you safe (CLAUDE.md sections 2 and 11), and what is left if Stakeward disappears
 * (`#recover`): the recovery cards, the guide, the source code and what changes on the network.
 */
export function Security() {
  return (
    <Section id="security" title={t('landing.security.title')}>
      <ul className="grid gap-x-8 gap-y-1 text-sm sm:gap-y-2.5 md:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span className="text-pretty">{t(`landing.security.items.${item}`)}</span>
          </li>
        ))}
      </ul>
      <SubSection id="recover" title={t('landing.recover.title')} className="mt-3">
        <p className="max-w-prose text-sm text-pretty sm:text-base">{t('landing.recover.body')}</p>
        <ul className="flex flex-col gap-1 text-sm sm:block sm:leading-6">
          <RecoverLink>
            <PageLink href="/app">{t('landing.recover.cards')}</PageLink>
          </RecoverLink>
          <RecoverLink>
            <ExternalLink href={README_RECOVERY_URL} label={t('landing.recover.guideLink')} />
          </RecoverLink>
          <RecoverLink>
            <ExternalLink href={SOURCE_CODE_URL} label={t('landing.security.sourceLink')} />
          </RecoverLink>
          <RecoverLink last>
            <HashLink href="#faq-on-chain">{t('landing.recover.onChain')}</HashLink>
          </RecoverLink>
        </ul>
      </SubSection>
    </Section>
  );
}
