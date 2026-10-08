import { ExternalLinkIcon } from 'lucide-react';
import { Link } from 'wouter';
import { CANNOT_DO_PATH, SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm underline underline-offset-4 hover:text-foreground';

/**
 * On every page (UX rule 12): what Stakeward never does, then the source code, what Stakeward cannot do, the numbers
 * (DECISIONS.md D82) and no warranty (CLAUDE.md section 11). The source code is on another site: it opens in a new tab
 * and says so (step 8 spec L14). From 640 px the license stands left and the links right; the license is plain text
 * after the links in the DOM, so no link changes its place in the tab order.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted">
        <p>{t('footer.trust')}</p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center sm:justify-between sm:gap-6">
          <nav aria-label={t('footer.label')}>
            <ul role="list" className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <li>
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
              </li>
              <li>
                <a className={LINK_CLASS} href={CANNOT_DO_PATH}>
                  {t('footer.cannotDo')}
                </a>
              </li>
              <li>
                <Link className={LINK_CLASS} href="/stats">
                  {t('footer.stats')}
                </Link>
              </li>
            </ul>
          </nav>
          <p>{t('footer.license')}</p>
        </div>
      </div>
    </footer>
  );
}
