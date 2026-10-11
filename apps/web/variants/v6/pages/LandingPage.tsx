import { formatSol, LAMPORTS_PER_SIGNATURE, type Cluster } from '@stakeward/core';
import { CheckIcon, MinusIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { CLUSTER } from '@/config';
import { t } from '@/i18n';
import { MAX_RESCUE_ACCOUNTS } from '@/pages/rescue/wizard';
import { Hero } from './landing/Hero.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { learnPathForHash } from './LearnPage.tsx';

const LINK = 'rounded-sm font-medium underline decoration-2 underline-offset-4 hover:decoration-4';

/**
 * One question and its short answer, always visible; the longer answer opens under it. A native <details>, so it
 * works without script and a link to its id (/#cannot-do) opens it (useHashTarget).
 */
function Answer({ id, question, short, children }: { id?: string; question: string; short: ReactNode; children: ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-4 border-t-2 border-foreground">
      <summary className="summary-plain grid cursor-pointer gap-x-10 gap-y-2 rounded-sm py-5 sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)_auto] sm:py-7">
        <h2 className="text-2xl leading-tight sm:text-3xl">{question}</h2>
        <p className="text-lg text-pretty sm:pt-1">{short}</p>
        <span className="hidden size-8 items-center justify-center self-start rounded-full border-2 border-foreground sm:inline-flex">
          <PlusIcon aria-hidden="true" className="size-4 group-open:hidden" />
          <MinusIcon aria-hidden="true" className="hidden size-4 group-open:block" />
        </span>
        <span className="text-sm font-medium underline underline-offset-4 sm:hidden">
          <span className="group-open:hidden">Read more</span>
          <span className="hidden group-open:inline">Show less</span>
        </span>
      </summary>
      <div className="grid gap-x-10 pb-8 sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)_auto]">
        <div className="flex max-w-prose flex-col gap-4 text-base text-pretty sm:col-start-2">{children}</div>
      </div>
    </details>
  );
}

function Ticks({ items, icon }: { items: string[]; icon: 'yes' | 'no' }) {
  const Icon = icon === 'yes' ? CheckIcon : XIcon;
  return (
    <ul role="list" className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Icon aria-hidden="true" className="mt-1 size-4 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * v6 "Verdict first" landing: the question and the field own the first screen; everything a judge or a careful staker
 * wants explained is a short answer below, one line each, open for more. The second key's limit and "What Stakeward
 * cannot do" are answers of their own, with their honest one-line version always visible.
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
    <Page>
      <Hero cluster={cluster} />
      {/* The two answers the check can give, said before anyone pastes anything: the whole product in two lines. */}
      <section aria-labelledby="two-answers-title" className="flex flex-col gap-4">
        <h2 id="two-answers-title" className="text-lg font-semibold">
          The answer is one of two
        </h2>
        <div className="grid gap-px bg-foreground sm:grid-cols-2">
          <div className="flex flex-col gap-2 bg-background py-5 sm:pr-8">
            <p className="font-condensed text-4xl text-verdict-yes">Yes.</p>
            <p className="max-w-md text-lg text-pretty">
              Some of your stake has no lock. Anyone with your main key can withdraw it today. Stakeward locks it with a second key you hold.
            </p>
          </div>
          <div className="flex flex-col gap-2 bg-background py-5 sm:pl-8">
            <p className="font-condensed text-4xl text-verdict-no">No.</p>
            <p className="max-w-md text-lg text-pretty">
              Every stake account is locked by your second key. A thief with only your main key gets no SOL until the lock ends.
            </p>
          </div>
        </div>
      </section>
      <section aria-label="Short answers" className="flex flex-col border-b-2 border-foreground">
        <Answer question="How is this possible?" short={t('landing.how.intro')}>
          <ol className="flex flex-col gap-3">
            {(['step1', 'step2', 'step3'] as const).map((step, index) => (
              <li key={step} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2">
                <span className="font-mono text-sm leading-6 font-medium">{index + 1}.</span>
                <span>
                  <span className="font-semibold">{t(`landing.how.${step}.title`)}.</span> {t(`landing.how.${step}.body`)}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-muted">
            {t('landing.how.period')} {devnet ? t('landing.how.periodDevnet') : null}
          </p>
        </Answer>
        <Answer question="What does a thief with my main key get?" short={t('landing.protects.thief')}>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">{t('landing.protects.needsSecondTitle')}</h3>
              <Ticks
                icon="yes"
                items={[t('landing.protects.needsSecond.withdraw'), t('landing.protects.needsSecond.owner'), t('landing.protects.needsSecond.lock')]}
              />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">{t('landing.protects.mainAloneTitle')}</h3>
              <Ticks
                icon="no"
                items={[
                  t('landing.protects.mainAlone.deactivate'),
                  t('landing.protects.mainAlone.redelegate'),
                  t('landing.protects.mainAlone.split'),
                  t('landing.protects.mainAlone.manager'),
                ]}
              />
            </div>
          </div>
          <p>
            <Link href="/rescue" className={LINK}>
              {t('nav.rescue')}
            </Link>{' '}
            moves locked stake to a new wallet when your main key, second key and the new wallet sign together.
          </p>
        </Answer>
        <Answer
          question="What is the catch?"
          short="Whoever holds your second key can freeze your stake by moving the lock date. It cannot take your SOL."
        >
          <p>{t('landing.secondKey.freeze')}</p>
          <Ticks icon="yes" items={[t('landing.secondKey.differentSeed'), t('landing.secondKey.apart')]} />
          <p>
            <Link href="/learn/faq#faq-good-second-key" className={LINK}>
              {t('landing.secondKey.more')}
            </Link>
          </p>
        </Answer>
        <Answer
          question="What does it cost?"
          short={`Nothing but Solana network fees: ${formatSol(LAMPORTS_PER_SIGNATURE)} per signature. No token, no subscription.`}
        >
          <p>{t('landing.points.noCustody')}. {t('common.neverSeedPhrase')}</p>
          <p>
            {t('landing.fees.protect')}: {t('landing.fees.protectPayer')} {t('landing.fees.rescue')}: {t('landing.fees.rescuePayer')}
          </p>
          <p>
            <Link href="/learn/costs" className={LINK}>
              {t('learn.tabs.costs')}
            </Link>
          </p>
        </Answer>
        <Answer id="cannot-do" question={`${t('landing.cannotDo.title')}?`} short={t('landing.cannotDo.intro')}>
          <ul role="list" className="flex flex-col gap-2">
            {(['scope', 'mainKeyActions', 'split', 'afterEnd', 'lostKey', 'freeze', 'sameSeed', 'newAccounts', 'cliKeys', 'alerts'] as const).map(
              (item) => (
                <li key={item} className="flex items-start gap-2">
                  <XIcon aria-hidden="true" className="mt-1 size-4 shrink-0" />
                  <span>{t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}</span>
                </li>
              ),
            )}
          </ul>
        </Answer>
        <Answer id="for-second-key" question={t('landing.coSign.title')} short="Sign only if the person asked you by voice or in person.">
          <p>{t('landing.coSign.body')}</p>
          <p>
            <Link href="/learn/faq#faq-co-sign" className={LINK}>
              {t('landing.coSign.more')}
            </Link>
          </p>
        </Answer>
      </section>
      <p className="text-base">
        <Link href="/learn/faq" className={LINK}>
          {t('footer.learn')}
        </Link>
        <span className="text-muted">: alerts, wallets, safety and every other question.</span>
      </p>
    </Page>
  );
}
