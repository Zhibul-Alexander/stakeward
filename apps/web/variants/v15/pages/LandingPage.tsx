import type { Cluster } from '@stakeward/core';
import { ChevronRightIcon, LockIcon, LockOpenIcon } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CLUSTER, GATE_RESULTS_URL, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey, type Messages } from '@/i18n';
import { MAX_RESCUE_ACCOUNTS } from '@/pages/rescue/wizard';
import { Bullets, PlainLink, PlainSection, PROSE_LINK, WarningText } from './landing/Plain.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { LEARN_TABS, learnPathForHash } from './LearnPage.tsx';

type CannotDoItem = keyof Messages['landing']['cannotDo']['items'];
const CANNOT_DO: readonly CannotDoItem[] = [
  'scope',
  'mainKeyActions',
  'split',
  'afterEnd',
  'lostKey',
  'freeze',
  'sameSeed',
  'newAccounts',
  'cliKeys',
  'alerts',
];

/** What the lock stops, one row per action: the answer is a word and an icon, the colour only repeats it. */
const LOCK_TABLE: readonly { action: MessageKey; blocked: boolean }[] = [
  { action: 'landing.protects.needsSecond.withdraw', blocked: true },
  { action: 'landing.protects.needsSecond.owner', blocked: true },
  { action: 'landing.protects.needsSecond.lock', blocked: true },
  { action: 'landing.protects.mainAlone.deactivate', blocked: false },
  { action: 'landing.protects.mainAlone.redelegate', blocked: false },
  { action: 'landing.protects.mainAlone.split', blocked: false },
  { action: 'landing.protects.mainAlone.manager', blocked: false },
];

/**
 * v15 `/`: a start page. What the service does, what you need, what it costs, one start button, then the plain facts
 * in reading order. A one-third aside holds the routes for someone who arrives with a problem (stolen key, a co-sign
 * link). Old hashes of the one-page layout still go to /learn, and `#cannot-do`, `#second-key` and `#for-second-key`
 * still land here.
 */
export function LandingPage({ cluster = CLUSTER }: { cluster?: Cluster | undefined }) {
  useHashTarget();
  useEffect(() => {
    const follow = () => {
      const moved = learnPathForHash(window.location.hash);
      if (moved !== null) window.location.replace(moved);
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener('hashchange', follow);
    };
  }, []);
  const devnet = cluster === 'devnet';

  return (
    <Page className="gap-10 sm:gap-12">
      <div className="grid gap-10 md:grid-cols-3 md:gap-12">
        <section aria-labelledby="landing-title" className="flex flex-col gap-6 md:col-span-2">
          <h1 id="landing-title" className="text-3xl text-balance">
            {t('landing.title')}
          </h1>
          <p className="measure text-lg text-pretty">{t('landing.lead')}</p>

          <div className="flex flex-col gap-3">
            <p>Use this service to:</p>
            <Bullets>
              <li>lock stake accounts you already have, with a second wallet that you control</li>
              <li>get a Telegram message when anything changes in them, and before a lock ends</li>
              <li>withdraw with both wallets, or move the stake to a new wallet if your main key is stolen</li>
            </Bullets>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Before you start</h2>
            <p>You will need:</p>
            <Bullets>
              <li>the wallet you staked from: this is your Main key</li>
              <li>a second wallet, made from a different seed phrase: this is your Second key</li>
              <li>a little SOL in the main wallet to pay network fees</li>
            </Bullets>
            <p className="measure text-pretty">
              Stakeward is free. You pay only Solana network fees, about 0.000005 SOL per signature. Each stake account
              takes one transaction, signed by both wallets.
            </p>
            <p className="measure text-pretty">
              {t('landing.how.period')}
              {devnet ? ` ${t('landing.how.periodDevnet')}` : null}
            </p>
          </div>

          <div className="flex flex-col items-start gap-3">
            <Button asChild size="lg" className="min-h-14 px-6 text-lg font-bold">
              <Link href="/app">
                {t('landing.checkStake')}
                {/* The start-page convention: the one button that begins the service points onward. */}
                <ChevronRightIcon aria-hidden="true" className="size-6" />
              </Link>
            </Button>
            <p className="text-sm">{t('landing.checkStakeHint')}</p>
            <p className="measure text-pretty">
              Already checked? <PlainLink href="/protect">{t('landing.protectStake')}</PlainLink>.
            </p>
          </div>

          <div id="second-key" className="scroll-mt-4">
            <WarningText>
              Whoever holds your second key can freeze this stake by moving the lock date. {t('landing.secondKey.freeze')}{' '}
              Keep it as safe as your main key.
            </WarningText>
          </div>
        </section>

        <aside aria-labelledby="help-now-title" className="flex flex-col gap-8 md:pt-2">
          <div className="flex flex-col gap-3 border-t-4 border-foreground pt-4">
            <h2 id="help-now-title" className="text-lg font-bold">
              If something is wrong now
            </h2>
            <ul role="list" className="flex flex-col gap-3">
              <li>
                Main key stolen? <PlainLink href="/rescue">{t('app.results.rescue')}</PlainLink>
              </li>
              <li>
                Sent a link to co-sign? <a href="#for-second-key" className={PROSE_LINK}>Read this first</a>
              </li>
            </ul>
          </div>
          <div className="flex flex-col gap-3 border-t-4 border-foreground pt-4">
            <h2 className="text-lg font-bold">See it before you use it</h2>
            <ul role="list" className="flex flex-col gap-3">
              <li>
                <PlainLink href="/demo">{t('landing.demoLink')}</PlainLink>
              </li>
              <li>
                {devnet ? (
                  <a href={MAINNET_SITE_URL} className={PROSE_LINK}>
                    {t('landing.tryMainnet')}
                  </a>
                ) : (
                  <a href={TESTNET_SITE_URL} className={PROSE_LINK}>
                    {t('landing.tryTestnet')}
                  </a>
                )}
              </li>
            </ul>
          </div>
          <div className="flex flex-col gap-3 border-t-4 border-foreground pt-4">
            <h2 className="text-lg font-bold">{t('landing.learnMore.title')}</h2>
            <ul role="list" className="flex flex-col gap-3">
              {LEARN_TABS.map((id) => (
                <li key={id} className="flex flex-col">
                  <PlainLink href={`/learn/${id}`}>{t(`learn.tabs.${id}`)}</PlainLink>
                  <span className="text-sm text-muted">{t(`landing.learnMore.${id}`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <div className="flex flex-col gap-12 md:w-2/3">
        <PlainSection id="protects" title={t('landing.protects.title')}>
          <p className="measure text-pretty">
            {t('landing.how.intro')} While the lock holds, this is what someone with only your main key can do.
          </p>
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">What someone with only your main key can do while the lock holds</caption>
            <thead>
              <tr className="border-b-2 border-foreground">
                <th scope="col" className="py-2 pr-4 font-bold">
                  Action
                </th>
                <th scope="col" className="py-2 font-bold">
                  With only your main key
                </th>
              </tr>
            </thead>
            <tbody>
              {LOCK_TABLE.map(({ action, blocked }) => (
                <tr key={action} className="border-b border-border">
                  <th scope="row" className="py-3 pr-4 align-top font-normal text-pretty">
                    {t(action)}
                  </th>
                  <td className="py-3 align-top">
                    {blocked ? (
                      <Badge tone="success" size="md">
                        <LockIcon aria-hidden="true" />
                        Blocked
                      </Badge>
                    ) : (
                      <Badge tone="neutral" size="md">
                        <LockOpenIcon aria-hidden="true" />
                        Still possible
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="measure font-bold text-pretty">{t('landing.protects.thief')}</p>
          <p className="measure text-pretty">
            {t('landing.secondKey.differentSeed')} {t('landing.secondKey.apart')}{' '}
            <a href="/learn/faq#faq-good-second-key" className={PROSE_LINK}>
              {t('landing.secondKey.more')}
            </a>
            .
          </p>
        </PlainSection>

        <PlainSection id="why" title="Why this exists">
          <p className="measure text-pretty">
            On 8 September 2025, 192,600 SOL left SwissBorg's staking after a hacked staking API slipped a hidden change of
            the withdraw key into a transaction. On 31 January 2026, Step Finance lost 261,854 SOL.
          </p>
          <p className="measure text-pretty">
            Every Solana stake account has a lock built into the stake program. While it holds, withdrawing or changing who
            can withdraw also needs the second key's signature. Stakeward has no program of its own: it only turns that
            lock on.
          </p>
          <p className="measure text-pretty">
            On 5 October 2026, Stakeward's test script ran 8 checks of these rules against the real stake program on Solana
            mainnet. All 8 gave the expected result.{' '}
            <a href={GATE_RESULTS_URL} target="_blank" rel="noreferrer" className={PROSE_LINK} aria-label={`Read the test results ${t('common.opensInNewTab')}`}>
              Read the test results (GitHub)
            </a>
          </p>
        </PlainSection>

        <PlainSection id="cannot-do" title={t('landing.cannotDo.title')}>
          <p className="measure">{t('landing.cannotDo.intro')} Stakeward cannot:</p>
          <Bullets>
            {CANNOT_DO.map((item) => (
              <li key={item} className="text-pretty">
                {t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}
              </li>
            ))}
          </Bullets>
        </PlainSection>

        <PlainSection id="for-second-key" title={t('landing.coSign.title')}>
          <p className="measure text-pretty">{t('landing.coSign.body')}</p>
          <p>
            <a href="/learn/faq#faq-co-sign" className={PROSE_LINK}>
              {t('landing.coSign.more')}
            </a>
          </p>
        </PlainSection>
      </div>
    </Page>
  );
}
