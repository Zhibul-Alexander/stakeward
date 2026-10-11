import type { Address } from '@solana/kit';
import type { Cluster } from '@stakeward/core';
import { cn } from 'cn';
import {
  ArrowUpIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  GlobeIcon,
  KeyRoundIcon,
  LockIcon,
  PlayIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Avatar,
  Bubble,
  CHIP_CLASS,
  FromStakeward,
  FromVisitor,
  Page,
  ReplyChips,
  ThreadDivider,
  TypingIndicator,
} from '@/components/layout/Page';
import { CLUSTER, MAINNET_SITE_URL, SOURCE_CODE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type Messages, type MessageKey } from '@/i18n';
import { isCheckableAddress } from '@/pages/app/AddressForm';
import { MAX_RESCUE_ACCOUNTS } from '@/pages/rescue/wizard';
import { useHashTarget } from './landing/use-hash-target.ts';
import { LEARN_TABS, learnPathForHash } from './LearnPage.tsx';

/*
 * v9 "Conversation": the landing page is a short chat with a careful security expert. Stakeward opens with three
 * messages; the visitor picks a reply chip and the answer arrives as the next messages. Every answer is plain React
 * state: the chips are buttons, the thread is a polite live region (role="log"), and the visitor's question is the h2
 * of its answer. The typing dots are skipped under prefers-reduced-motion. The address composer at the bottom opens
 * /app?address=, the same look-first path as "Check my stake".
 */

type Topic = 'check' | 'thief' | 'setup' | 'cost' | 'catch' | 'cosign';

const TOPICS: readonly Topic[] = ['check', 'thief', 'setup', 'cost', 'catch', 'cosign'];

const QUESTION: Record<Topic, string> = {
  check: 'Check my wallet',
  thief: 'How can a lock stop a thief?',
  setup: 'How do I set it up?',
  cost: 'What does it cost?',
  catch: "What's the catch?",
  cosign: 'Someone sent me a link to co-sign',
};

/** Anchors other pages link to: the footer's "What Stakeward cannot do" and /cosign's "What is Stakeward?". */
const HASH_TOPIC: Record<string, Topic> = {
  '#cannot-do': 'catch',
  '#second-key': 'catch',
  '#for-second-key': 'cosign',
  '#how-it-works': 'setup',
  '#protects': 'thief',
};

const TYPING_MS = 650;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function topicFromHash(): Topic | null {
  if (typeof window === 'undefined') return null;
  return HASH_TOPIC[window.location.hash] ?? null;
}

export function LandingPage({ cluster = CLUSTER }: { cluster?: Cluster | undefined }) {
  const devnet = cluster === 'devnet';
  const [asked, setAsked] = useState<Topic[]>(() => {
    const fromHash = topicFromHash();
    return fromHash === null ? [] : [fromHash];
  });
  const [typing, setTyping] = useState<Topic | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);

  useHashTarget();
  // The old one-page layout's anchors go to their place on /learn; the ones this thread answers open their topic.
  useEffect(() => {
    const follow = () => {
      const moved = learnPathForHash(window.location.hash);
      if (moved !== null) {
        window.location.replace(moved);
        return;
      }
      const topic = topicFromHash();
      if (topic !== null) {
        setAsked((list) => (list.includes(topic) ? list : [...list, topic]));
        // The anchor itself (the card of what Stakeward cannot do), not the start of its exchange.
        setScrollTo(decodeURIComponent(window.location.hash.slice(1)));
      }
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener('hashchange', follow);
    };
  }, []);

  // While Stakeward "types", the answer waits; without motion it comes at once.
  useEffect(() => {
    if (typing === null) return;
    const timer = window.setTimeout(() => {
      setTyping(null);
    }, TYPING_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [typing]);

  // Bring the new exchange into view (under the sticky header) once it is drawn.
  useEffect(() => {
    if (scrollTo === null) return;
    const target = document.getElementById(scrollTo);
    target?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    setScrollTo(null);
  }, [scrollTo]);

  // "Check my wallet" hands the keyboard to the composer once the answer is in.
  const wantsComposer = asked.at(-1) === 'check' && typing === null;
  const focusedComposer = useRef(false);
  useEffect(() => {
    if (wantsComposer && !focusedComposer.current) {
      focusedComposer.current = true;
      composerRef.current?.focus({ preventScroll: true });
    }
  }, [wantsComposer]);

  const ask = (topic: Topic) => {
    setAsked((list) => [...list, topic]);
    setTyping(reducedMotion() ? null : topic);
    setScrollTo(`ask-${topic}`);
    if (topic === 'check') focusedComposer.current = false;
    // The chip goes away with the question; the keyboard stays among the replies.
    window.setTimeout(() => {
      const next = chipsRef.current?.querySelector<HTMLElement>('button, a');
      if (topic !== 'check') next?.focus({ preventScroll: true });
    }, 0);
  };

  const remaining = TOPICS.filter((topic) => !asked.includes(topic));

  return (
    <Page width="app" className="max-w-5xl">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-6">
          <div role="log" aria-label="Conversation with Stakeward" className="flex flex-col gap-6">
            <ThreadDivider>
              {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}. {t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}
            </ThreadDivider>

            <section aria-labelledby="landing-title" className="flex flex-col gap-1.5">
              <FromStakeward>
                <Bubble className="px-5 py-4 sm:px-6 sm:py-5">
                  <h1 id="landing-title" className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
                    I can lock your staked SOL, so a stolen key can't withdraw it.
                  </h1>
                </Bubble>
              </FromStakeward>
              <FromStakeward>
                <Bubble>
                  Every Solana stake account has a lock built in. I turn it on, and the key to it goes to a second wallet you
                  control.
                </Bubble>
              </FromStakeward>
              <FromStakeward>
                <Bubble>
                  Your SOL stays in your stake accounts and keeps earning. It's free: you pay only network fees. And I will
                  never ask for your seed phrase.
                </Bubble>
              </FromStakeward>
              <FromStakeward first>
                <Bubble>
                  One honest catch: whoever holds your second key can freeze the stake, though never take it. Ask me about it.
                </Bubble>
              </FromStakeward>
            </section>

            {asked.map((topic, index) => (
              <Exchange
                key={topic}
                topic={topic}
                typing={typing === topic && index === asked.length - 1}
                devnet={devnet}
              />
            ))}
          </div>

          {remaining.length === 0 ? null : (
            <div ref={chipsRef}>
              <ReplyChips label="Ask Stakeward">
                {remaining.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => {
                      ask(topic);
                    }}
                    className={cn(
                      CHIP_CLASS,
                      topic === 'check' && 'border-transparent bg-primary text-on-primary hover:bg-primary-hover hover:text-on-primary',
                    )}
                  >
                    {QUESTION[topic]}
                  </button>
                ))}
              </ReplyChips>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-x-5 gap-y-2 pl-6 text-sm sm:pl-24">
            <QuietLink href="/demo" icon={<PlayIcon aria-hidden="true" />}>
              {t('landing.demoLink')}
            </QuietLink>
            <QuietLink href="/protect" icon={<ShieldCheckIcon aria-hidden="true" />}>
              {t('landing.protectStake')}
            </QuietLink>
            <QuietLink href="/learn" icon={<BookOpenIcon aria-hidden="true" />} className="lg:hidden">
              Read every detail
            </QuietLink>
            <a href={devnet ? MAINNET_SITE_URL : TESTNET_SITE_URL} className={QUIET_LINK_CLASS}>
              {devnet ? <GlobeIcon aria-hidden="true" /> : <FlaskConicalIcon aria-hidden="true" />}
              {devnet ? t('landing.tryMainnet') : t('landing.tryTestnet')}
            </a>
          </div>

          <Composer inputRef={composerRef} />
        </div>

        <ContactPane devnet={devnet} />
      </div>
    </Page>
  );
}

const QUIET_LINK_CLASS =
  'inline-flex items-center gap-1.5 rounded-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary [&_svg]:size-4 [&_svg]:shrink-0';

function QuietLink({ href, icon, children, className }: { href: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn(QUIET_LINK_CLASS, className)}>
      {icon}
      {children}
    </Link>
  );
}

/** One question and its answer: the visitor's bubble is the h2, Stakeward's messages follow. */
function Exchange({ topic, typing, devnet }: { topic: Topic; typing: boolean; devnet: boolean }) {
  const anchor = topic === 'cosign' ? 'for-second-key' : undefined;
  return (
    <section
      id={anchor}
      aria-labelledby={`ask-${topic}-title`}
      className="flex scroll-mt-24 flex-col gap-4"
    >
      <span id={`ask-${topic}`} className="block scroll-mt-24" />
      <FromVisitor className="message-in">
        <h2 id={`ask-${topic}-title`} className="text-base font-semibold">
          {QUESTION[topic]}
        </h2>
      </FromVisitor>
      {typing ? (
        <TypingIndicator label="Stakeward is typing" />
      ) : (
        <div className="message-in flex flex-col gap-1.5">
          <Answer topic={topic} devnet={devnet} />
        </div>
      )}
    </section>
  );
}

function Answer({ topic, devnet }: { topic: Topic; devnet: boolean }) {
  switch (topic) {
    case 'check':
      return (
        <>
          <FromStakeward>
            <Bubble>Paste the address you staked from in the box below. Your second key's address works too.</Bubble>
          </FromStakeward>
          <FromStakeward first>
            <Bubble>Looking needs no wallet and signs nothing. You connect a wallet only when you decide to act.</Bubble>
          </FromStakeward>
        </>
      );
    case 'thief':
      return (
        <>
          <FromStakeward>
            <Bubble>
              The lock lives in Solana's stake program, not in Stakeward. While it holds, the network itself refuses some
              actions unless your second key signs too.
            </Bubble>
          </FromStakeward>
          <FromStakeward>
            <LockCard />
          </FromStakeward>
          <FromStakeward>
            <Bubble className="font-semibold">{t('landing.protects.thief')}</Bubble>
          </FromStakeward>
          <FromStakeward first>
            <Bubble>
              Turn on alerts and I check every few minutes, then message you in Telegram when anything changes. If a thief
              strikes, your main key, your second key and a new wallet sign together, and the stake moves to the new wallet.
            </Bubble>
          </FromStakeward>
        </>
      );
    case 'setup':
      return (
        <>
          <FromStakeward>
            <Bubble>Three steps. You sign each one in your own wallet.</Bubble>
          </FromStakeward>
          <FromStakeward>
            <StepsCard />
          </FromStakeward>
          <FromStakeward>
            <Bubble>
              {t('landing.how.period')}
              {devnet ? ` ${t('landing.how.periodDevnet')}` : null}
            </Bubble>
          </FromStakeward>
          <FromStakeward first>
            <Bubble>Your browser builds every transaction and your wallets sign it. My server never signs and never holds SOL.</Bubble>
          </FromStakeward>
        </>
      );
    case 'cost':
      return (
        <>
          <FromStakeward>
            <Bubble>Nothing for me. Stakeward is free, and there is no token.</Bubble>
          </FromStakeward>
          <FromStakeward>
            <Bubble>
              The network charges about 0.000005 SOL per signature. Your main key pays to protect, your second key pays to
              extend, and a new wallet pays for a rescue.
            </Bubble>
          </FromStakeward>
          <FromStakeward first>
            <Bubble>
              Signing from two devices by link needs a small deposit, about 0.0015 SOL. You get it back when you close it.{' '}
              <Link href="/learn/costs" className={QUIET_LINK_CLASS}>
                See every fee
              </Link>
            </Bubble>
          </FromStakeward>
        </>
      );
    case 'catch':
      return (
        <>
          <FromStakeward>
            <Bubble>Two things. I'd rather you hear them before you start.</Bubble>
          </FromStakeward>
          <FromStakeward>
            <div id="second-key" className="scroll-mt-24">
              <Bubble tone="warning">
                <p className="flex items-start gap-2">
                  <TriangleAlertIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-warning" />
                  <span>
                    <span className="font-semibold">Whoever holds your second key can freeze this stake</span> by moving the
                    lock date. {t('landing.secondKey.freeze')}
                  </span>
                </p>
              </Bubble>
            </div>
          </FromStakeward>
          <FromStakeward>
            <Bubble>
              So make the second key from a different seed phrase, and keep it apart from your main key: a hardware wallet,
              another device or a person you trust.{' '}
              <a href="/learn/faq#faq-good-second-key" className={QUIET_LINK_CLASS}>
                {t('landing.secondKey.more')}
              </a>
            </Bubble>
          </FromStakeward>
          <FromStakeward>
            <Bubble>And the lock has limits. Read these before you protect anything:</Bubble>
          </FromStakeward>
          <FromStakeward first>
            <CannotDoCard />
          </FromStakeward>
        </>
      );
    case 'cosign':
      return (
        <>
          <FromStakeward>
            <Bubble>Then someone made your wallet their second key.</Bubble>
          </FromStakeward>
          <FromStakeward first>
            <Bubble>
              Sign only if they asked you by voice or in person. Co-signing never moves your own SOL.{' '}
              <a href="/learn/faq#faq-co-sign" className={QUIET_LINK_CLASS}>
                {t('landing.coSign.more')}
              </a>
            </Bubble>
          </FromStakeward>
        </>
      );
  }
}

const NEEDS_SECOND: readonly MessageKey[] = ['landing.protects.needsSecond.withdraw', 'landing.protects.needsSecond.owner', 'landing.protects.needsSecond.lock'];
const MAIN_ALONE: readonly MessageKey[] = [
  'landing.protects.mainAlone.deactivate',
  'landing.protects.mainAlone.redelegate',
  'landing.protects.mainAlone.split',
  'landing.protects.mainAlone.manager',
];

/** An attachment: a white card under the bubbles, as wide as the thread. */
function Attachment({ children, className, id, labelledBy }: { children: ReactNode; className?: string; id?: string; labelledBy?: string }) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn('w-full scroll-mt-24 overflow-hidden rounded-xl rounded-tl-md border border-bubble-in-border bg-surface shadow-bubble', className)}
    >
      {children}
    </section>
  );
}

function LockCard() {
  const id = useId();
  return (
    <Attachment labelledBy={`${id}-title`} id="protects">
      <h3 id={`${id}-title`} className="sr-only">
        {t('landing.protects.title')}
      </h3>
      <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex flex-col gap-2.5 p-4 sm:p-5">
          <h4 className="flex items-center gap-2 text-sm font-bold text-success">
            <LockIcon aria-hidden="true" className="size-4" />
            {t('landing.protects.needsSecondTitle')}
          </h4>
          <ul className="flex flex-col gap-1.5 text-sm">
            {NEEDS_SECOND.map((key) => (
              <li key={key} className="flex items-start gap-2">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2.5 bg-subtle/50 p-4 sm:p-5">
          <h4 className="flex items-center gap-2 text-sm font-bold text-neutral">
            <KeyRoundIcon aria-hidden="true" className="size-4" />
            {t('landing.protects.mainAloneTitle')}
          </h4>
          <ul className="flex flex-col gap-1.5 text-sm">
            {MAIN_ALONE.map((key) => (
              <li key={key} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-neutral" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Attachment>
  );
}

function StepsCard() {
  const steps = ['step1', 'step2', 'step3'] as const;
  return (
    <Attachment id="how-it-works" labelledBy="how-it-works-title">
      <h3 id="how-it-works-title" className="sr-only">
        {t('landing.how.title')}
      </h3>
      <ol className="flex flex-col divide-y divide-border">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 p-4 sm:gap-4 sm:px-5">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary tabular-nums"
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h4 className="text-base font-bold">{t(`landing.how.${step}.title`)}</h4>
              <p className="text-sm text-pretty text-muted">{t(`landing.how.${step}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
    </Attachment>
  );
}

type CannotDoItem = keyof Messages['landing']['cannotDo']['items'];
const CANNOT: readonly CannotDoItem[] = ['scope', 'mainKeyActions', 'split', 'afterEnd', 'lostKey', 'freeze', 'sameSeed', 'newAccounts', 'cliKeys', 'alerts'];

function CannotDoCard() {
  return (
    <Attachment id="cannot-do" labelledBy="cannot-do-title">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <h3 id="cannot-do-title" className="text-base font-bold">
          {t('landing.cannotDo.title')}
        </h3>
        <ul className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
          {CANNOT.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <XIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
              <span className="text-pretty">{t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}</span>
            </li>
          ))}
        </ul>
      </div>
    </Attachment>
  );
}

/** The message box at the foot of the thread: paste an address, see its stake on /app. */
function Composer({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const [, navigate] = useLocation();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  return (
    <div className="pt-1">
      <form
        noValidate
        aria-label={t('landing.checkStake')}
        onSubmit={(event) => {
          event.preventDefault();
          const address = text.trim();
          if (address === '') {
            setProblem(t('app.form.empty'));
            inputRef.current?.focus();
            return;
          }
          if (!isCheckableAddress(address)) {
            setProblem(t('app.form.invalid'));
            inputRef.current?.focus();
            return;
          }
          navigate(`/app?address=${encodeURIComponent(address as Address)}`);
        }}
        className="flex flex-col gap-2"
      >
        {problem === null ? null : (
          <p id={`${id}-error`} role="alert" className="px-4 text-sm font-medium text-danger">
            {problem}
          </p>
        )}
        <div className="flex items-center gap-2 rounded-full border border-border-strong/50 bg-surface py-1.5 pr-1.5 pl-5 shadow-bubble focus-within:border-primary">
          <label htmlFor={id} className="sr-only">
            {t('app.form.label')}
          </label>
          <input
            ref={inputRef}
            id={id}
            type="text"
            value={text}
            placeholder="Paste a wallet address"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={problem !== null}
            aria-describedby={problem === null ? `${id}-hint` : `${id}-error ${id}-hint`}
            onChange={(event) => {
              setText(event.target.value);
              if (problem !== null) setProblem(null);
            }}
            className="h-10 min-w-0 flex-1 bg-transparent font-mono text-base text-foreground outline-none placeholder:font-sans focus-visible:outline-none md:text-sm"
          />
          <button
            type="submit"
            aria-label={t('app.form.submit')}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition-colors hover:bg-primary-hover"
          >
            <ArrowUpIcon aria-hidden="true" className="size-5" />
          </button>
        </div>
        <p id={`${id}-hint`} className="px-5 text-xs text-muted">
          {t('landing.checkStakeHint')}
        </p>
      </form>
    </div>
  );
}

/** From 1024 px: who you are talking to, like a messaging app's contact pane. The details live here, not in the thread. */
function ContactPane({ devnet }: { devnet: boolean }) {
  return (
    <aside aria-label="About Stakeward" className="hidden lg:block">
      <div className="sticky top-24 flex flex-col gap-5 rounded-xl border border-bubble-in-border bg-surface p-5 shadow-bubble">
        <div className="flex flex-col items-center gap-2 text-center">
          <Avatar className="size-14 [&_svg]:size-6" />
          <p className="text-lg font-bold tracking-tight">{t('common.appName')}</p>
          <p className="text-sm text-pretty text-muted">{t('common.tagline')}</p>
        </div>
        <ul className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
          {(['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'] as const).map((key) => (
            <li key={key} className="flex items-start gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
        <nav aria-labelledby="pane-details" className="flex flex-col gap-1 border-t border-border pt-4">
          <p id="pane-details" className="pb-1 text-xs font-semibold text-muted">
            {t('landing.learnMore.title')}
          </p>
          {LEARN_TABS.map((tab) => (
            <Link
              key={tab}
              href={`/learn/${tab}`}
              className="-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle"
            >
              <span className="flex flex-col">
                <span className="font-semibold">{t(`learn.tabs.${tab}`)}</span>
                <span className="text-xs text-muted">{t(`landing.learnMore.${tab}`)}</span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted" />
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
          <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer" className={QUIET_LINK_CLASS} aria-label={`${t('footer.sourceCode')} ${t('common.opensInNewTab')}`}>
            {t('footer.sourceCode')}
            <ExternalLinkIcon aria-hidden="true" />
          </a>
          <p className="text-xs text-muted">{devnet ? t('common.devnetNote') : t('landing.network.mainnetNote')}</p>
        </div>
      </div>
    </aside>
  );
}
