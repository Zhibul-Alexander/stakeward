import { ExternalLinkIcon, LockKeyholeIcon } from 'lucide-react';
import { Link } from 'wouter';
import { CANNOT_DO_PATH, SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm underline decoration-border-strong underline-offset-4 hover:text-foreground hover:decoration-foreground';

/**
 * v9: the end of the thread. The promise first, as the line a messaging app prints under an encrypted chat, then the
 * same links as the base footer (source code in a new tab, what Stakeward cannot do, details, stats) and no warranty.
 */
export function SiteFooter() {
  return (
    <footer className="print:hidden">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 pt-6 pb-10 text-center text-sm text-muted">
        <p className="flex max-w-md items-start justify-center gap-2 rounded-xl bg-subtle px-4 py-2.5 text-xs text-pretty sm:text-sm">
          <LockKeyholeIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('footer.trust')}</span>
        </p>
        <nav aria-label={t('footer.label')}>
          <ul role="list" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:gap-x-6">
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
        <p className="text-xs">{t('footer.license')}</p>
      </div>
    </footer>
  );
}
