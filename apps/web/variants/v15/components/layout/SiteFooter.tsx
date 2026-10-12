import { Link } from 'wouter';
import { CANNOT_DO_PATH, SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';

const LINK_CLASS = 'inline-flex min-h-11 items-center text-foreground underline hover:decoration-3';

/**
 * v15 footer: a grey band with a dark top rule. The promise first, in full sentences, then the links in one row that
 * wraps, then the licence. The source code opens in a new tab and says so.
 */
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t-4 border-foreground bg-subtle print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 text-sm">
        <p className="measure">{t('footer.trust')}</p>
        <nav aria-label={t('footer.label')}>
          <ul role="list" className="flex flex-wrap items-center gap-x-6">
            <li>
              <a className={LINK_CLASS} href={SOURCE_CODE_URL} target="_blank" rel="noreferrer" aria-label={`${t('footer.sourceCode')} ${t('common.opensInNewTab')}`}>
                {t('footer.sourceCode')} (GitHub)
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
        <p className="text-muted">{t('footer.license')}</p>
      </div>
    </footer>
  );
}
