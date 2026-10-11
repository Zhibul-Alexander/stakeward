import { ExternalLinkIcon, LockKeyholeIcon } from 'lucide-react';
import { Link } from 'wouter';
import { CANNOT_DO_PATH, SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm hover:text-foreground hover:underline underline-offset-4';

/**
 * On every page (UX rule 12): what Stakeward never does, the source code, what Stakeward cannot do, details, the numbers
 * and no warranty. A quiet status-bar style strip in the v5 console.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border print:hidden">
      <div className="flex w-full flex-col gap-3 px-4 py-5 text-xs text-muted sm:px-6 lg:px-10">
        <p className="flex items-start gap-2">
          <LockKeyholeIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>{t('footer.trust')}</span>
        </p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center sm:justify-between sm:gap-6">
          <nav aria-label={t('footer.label')}>
            <ul role="list" className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <li>
                <a
                  className={LINK_CLASS}
                  href={SOURCE_CODE_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${t('footer.sourceCode')} ${t('common.opensInNewTab')}`}
                >
                  {t('footer.sourceCode')}
                  <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-3 align-baseline" />
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
          <p className="whitespace-nowrap">{t('footer.license')}</p>
        </div>
      </div>
    </footer>
  );
}
