import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { CANNOT_DO_PATH, IS_DEVNET, MAINNET_SITE_URL, SOURCE_CODE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm underline-offset-4 hover:underline';

function Item({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

/**
 * v6: the footer is the site's navigation. Two short columns (use it, check it), then the promise in large type and
 * the fine print. On every page: the source code and what Stakeward cannot do (UX rule 12), no warranty.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 bg-inverse text-on-inverse print:hidden sm:mt-24 [&_a:focus-visible]:outline-on-inverse">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
        <p className="font-condensed max-w-3xl text-2xl leading-tight font-bold text-balance sm:text-3xl">{t('footer.trust')}</p>
        <div className="grid gap-8 text-sm sm:grid-cols-3">
          <nav aria-label="Site">
            <ul role="list" className="flex flex-col gap-2">
              <Item>
                <Link className={LINK_CLASS} href="/app">
                  {t('nav.app')}
                </Link>
              </Item>
              <Item>
                <Link className={LINK_CLASS} href="/protect">
                  {t('landing.protectStake')}
                </Link>
              </Item>
              <Item>
                <Link className={LINK_CLASS} href="/rescue">
                  {t('nav.rescue')}
                </Link>
              </Item>
              <Item>
                <Link className={LINK_CLASS} href="/demo">
                  {t('nav.demo')}
                </Link>
              </Item>
              {IS_DEVNET ? (
                <Item>
                  <Link className={LINK_CLASS} href="/challenge">
                    {t('nav.challenge')}
                  </Link>
                </Item>
              ) : null}
            </ul>
          </nav>
          <nav aria-label={t('footer.label')}>
            <ul role="list" className="flex flex-col gap-2">
              <Item>
                <a className={LINK_CLASS} href={CANNOT_DO_PATH}>
                  {t('footer.cannotDo')}
                </a>
              </Item>
              <Item>
                <Link className={LINK_CLASS} href="/learn/faq">
                  {t('footer.learn')}
                </Link>
              </Item>
              <Item>
                <Link className={LINK_CLASS} href="/stats">
                  {t('footer.stats')}
                </Link>
              </Item>
              <Item>
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
              </Item>
            </ul>
          </nav>
          <div className="flex flex-col gap-2">
            <a className={LINK_CLASS} href={IS_DEVNET ? MAINNET_SITE_URL : TESTNET_SITE_URL}>
              {IS_DEVNET ? t('nav.tryMainnet') : t('nav.tryTestnet')}
            </a>
            <p className="opacity-80">{t('footer.license')}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
