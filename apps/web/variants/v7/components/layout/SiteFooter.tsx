import { ExternalLinkIcon } from 'lucide-react';
import { Link } from 'wouter';
import { CANNOT_DO_PATH, SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm underline underline-offset-4 hover:text-foreground';

/**
 * On every page (UX rule 12): what Stakeward never does, the source code, what Stakeward cannot do, the numbers and
 * no warranty. v7: the night strip again, closing the page as the header opens it.
 */
export function SiteFooter() {
  return (
    <footer className="scope-night border-t border-border print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted">
        <p className="max-w-prose text-base text-foreground">{t('footer.trust')}</p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center sm:justify-between sm:gap-6">
          <nav aria-label={t('footer.label')}>
            <ul role="list" className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-6">
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
                <Link className={LINK_CLASS} href="/learn/faq">
                  {t('footer.learn')}
                </Link>
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
