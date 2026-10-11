import { ExternalLinkIcon } from 'lucide-react';
import { Link } from 'wouter';
import { CANNOT_DO_PATH, SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';

const LINK_CLASS = 'underline decoration-2 underline-offset-4 hover:decoration-signal';

/**
 * Every page ends on an inverted ink block: the trust line set large, the links as a ruled row, the licence. Same
 * links, order and accessible names as the original footer.
 */
export function SiteFooter() {
  return (
    <footer className="ink-block print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14">
        <p className="max-w-3xl font-display text-xl leading-tight tracking-tight text-balance sm:text-2xl">{t('footer.trust')}</p>
        <div className="flex flex-col gap-4 border-t-2 border-background pt-4 text-sm sm:flex-row-reverse sm:items-center sm:justify-between sm:gap-6">
          <nav aria-label={t('footer.label')}>
            <ul role="list" className="flex flex-wrap items-center gap-x-4 gap-y-2 font-semibold sm:gap-x-6">
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
          <p className="micro">{t('footer.license')}</p>
        </div>
      </div>
    </footer>
  );
}
