import { ShieldCheckIcon } from 'lucide-react';
import { README_RECOVERY_URL, SOURCE_CODE_URL } from '@/config';
import { t, type Messages } from '@/i18n';
import { ExternalLink, HashLink, PageLink, Section, SubSection } from './Section.tsx';

type SecurityItem = keyof Messages['landing']['security']['items'];

/** `site` follows `server`: it starts with "So", the consequence of the same server delivering this website. */
const ITEMS: readonly SecurityItem[] = ['chain', 'browser', 'server', 'site', 'programs', 'open'];

/** The separator between two links of a row: for the eye only. */
function Dot() {
  return (
    <span aria-hidden="true" className="px-2 text-muted">
      ·
    </span>
  );
}

/**
 * How Stakeward keeps you safe (CLAUDE.md sections 2 and 11), and what is left if Stakeward disappears
 * (`#recover`): the recovery cards, the guide, the source code and what changes on the network.
 */
export function Security() {
  return (
    <Section id="security" title={t('landing.security.title')}>
      <ul className="grid gap-x-8 gap-y-1.5 text-sm sm:gap-y-2.5 md:grid-cols-2">
        {ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span className="text-pretty">{t(`landing.security.items.${item}`)}</span>
          </li>
        ))}
      </ul>
      <SubSection id="recover" title={t('landing.recover.title')} className="mt-3">
        <p className="max-w-prose text-sm text-pretty sm:text-base">{t('landing.recover.body')}</p>
        {/* One row of links that flows like a sentence, so on a phone it takes lines, not one line per link. */}
        <ul className="text-sm leading-6">
          <li className="inline">
            <PageLink href="/app">{t('landing.recover.cards')}</PageLink>
            <Dot />
          </li>
          <li className="inline">
            <ExternalLink href={README_RECOVERY_URL} label={t('landing.recover.guideLink')} />
            <Dot />
          </li>
          <li className="inline">
            <ExternalLink href={SOURCE_CODE_URL} label={t('landing.security.sourceLink')} />
            <Dot />
          </li>
          <li className="inline">
            <HashLink href="#faq-on-chain">{t('landing.recover.onChain')}</HashLink>
          </li>
        </ul>
      </SubSection>
    </Section>
  );
}
