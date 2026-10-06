import { ExternalLinkIcon } from 'lucide-react';
import { Link } from 'wouter';
import { CANNOT_DO_PATH, SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm underline underline-offset-4 hover:text-foreground';

/**
 * On every page (UX rule 12): source code, what Stakeward cannot do, the numbers (DECISIONS.md D82), no warranty
 * (CLAUDE.md section 11). The source code is on another site: it opens in a new tab and says so (step 8 spec L14).
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted">
        <a
          className={LINK_CLASS}
          href={SOURCE_CODE_URL}
          target="_blank"
          rel="noreferrer"
          aria-label={`${t('footer.sourceCode')} ${t('common.opensInNewTab')}`}
        >
          {t('footer.sourceCode')}
          <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-3.5 align-text-bottom" />
        </a>
        <a className={LINK_CLASS} href={CANNOT_DO_PATH}>
          {t('footer.cannotDo')}
        </a>
        <Link className={LINK_CLASS} href="/stats">
          {t('footer.stats')}
        </Link>
        <span>{t('footer.license')}</span>
      </div>
    </footer>
  );
}
