import { ChevronDownIcon, ExternalLinkIcon } from 'lucide-react';
import { SOURCE_CODE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

type FaqEntry = {
  /** The question's anchor: /#faq-<id> opens it (LandingPage). */
  id: string;
  question: MessageKey;
  /** The answer's paragraphs, in order. Only answers may use the program's words (custodian, withdrawer): UX rule 4. */
  answer: readonly MessageKey[];
  /** A link under the answer; it opens in a new tab. */
  link?: { href: string; label: MessageKey } | undefined;
};

/** README.md sections on GitHub: recovery with the Solana command line, without Stakeward. */
const RECOVER_URL = `${SOURCE_CODE_URL}#recover-without-stakeward`;
const SECOND_KEY_STOLEN_URL = `${SOURCE_CODE_URL}#second-key-stolen`;

/**
 * CLAUDE.md section 10 step 8: honest limits, which wallets and pairs work, what a Ledger shows. Everything that the
 * wallet matrix (step 3) may change lives in en.json under landing.faq.wallets and landing.faq.ledger, so its results
 * go in one place.
 */
const FAQ: readonly FaqEntry[] = [
  {
    id: 'lock',
    question: 'landing.faq.lock.question',
    answer: [
      'landing.faq.lock.answer.what',
      'landing.faq.lock.answer.other',
      'landing.faq.lock.answer.existing',
      'landing.faq.lock.answer.names',
    ],
  },
  {
    id: 'custody',
    question: 'landing.faq.custody.question',
    answer: ['landing.faq.custody.answer.no', 'landing.faq.custody.answer.server', 'landing.faq.custody.answer.screen'],
  },
  {
    id: 'cost',
    question: 'landing.faq.cost.question',
    answer: ['landing.faq.cost.answer.free', 'landing.faq.cost.answer.fee', 'landing.faq.cost.answer.deposit'],
  },
  {
    id: 'lock-ends',
    question: 'landing.faq.lockEnds.question',
    answer: ['landing.faq.lockEnds.answer.period', 'landing.faq.lockEnds.answer.extend', 'landing.faq.lockEnds.answer.after'],
  },
  {
    id: 'thief',
    question: 'landing.faq.thief.question',
    answer: ['landing.faq.thief.answer.cannot', 'landing.faq.thief.answer.can', 'landing.faq.thief.answer.rescue'],
  },
  {
    id: 'lose-second',
    question: 'landing.faq.loseSecond.question',
    answer: ['landing.faq.loseSecond.answer.wait', 'landing.faq.loseSecond.answer.after', 'landing.faq.loseSecond.answer.stolenToo'],
  },
  {
    id: 'second-stolen',
    question: 'landing.faq.secondStolen.question',
    answer: ['landing.faq.secondStolen.answer.cannot', 'landing.faq.secondStolen.answer.act', 'landing.faq.secondStolen.answer.late'],
    link: { href: SECOND_KEY_STOLEN_URL, label: 'landing.faq.secondStolen.link' },
  },
  {
    id: 'seed-phrase',
    question: 'landing.faq.seedPhrase.question',
    answer: ['landing.faq.seedPhrase.answer.why', 'landing.faq.seedPhrase.answer.how', 'landing.faq.seedPhrase.answer.confirm'],
  },
  {
    id: 'disappear',
    question: 'landing.faq.disappear.question',
    answer: ['landing.faq.disappear.answer.lock', 'landing.faq.disappear.answer.cli', 'landing.faq.disappear.answer.keys'],
    link: { href: RECOVER_URL, label: 'landing.faq.disappear.link' },
  },
  {
    id: 'wallets',
    question: 'landing.faq.wallets.question',
    answer: ['landing.faq.wallets.answer.standard', 'landing.faq.wallets.answer.checks', 'landing.faq.wallets.answer.untested'],
  },
  {
    id: 'ledger',
    question: 'landing.faq.ledger.question',
    answer: [
      'landing.faq.ledger.answer.format',
      'landing.faq.ledger.answer.newAuthority',
      'landing.faq.ledger.answer.withdraw',
      'landing.faq.ledger.answer.lighthouse',
      'landing.faq.ledger.answer.untested',
    ],
  },
  {
    id: 'phone',
    question: 'landing.faq.phone.question',
    // The last sentence waits for the wallet matrix, so it lives with the wallet answers.
    answer: ['landing.faq.phone.answer.inApp', 'landing.faq.phone.answer.desktop', 'landing.faq.wallets.phone'],
  },
  {
    id: 'lst',
    question: 'landing.faq.lst.question',
    answer: ['landing.faq.lst.answer.no', 'landing.faq.lst.answer.why'],
  },
];

/** A link that opens in a new tab shares neither this page (window.opener) nor its address (Referer). */
const NEW_TAB_REL = 'noopener noreferrer';

/**
 * Questions and answers on native <details>: no script, keyboard (Enter, Space) and screen readers for free, and the
 * global :focus-visible outline on each question.
 */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="flex flex-col gap-6">
      <h2 id="faq-title" className="text-2xl font-semibold">
        {t('landing.faq.title')}
      </h2>
      <div className="flex flex-col gap-3">
        {FAQ.map((entry) => (
          <FaqItem key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function FaqItem({ entry }: { entry: FaqEntry }) {
  const { link } = entry;
  return (
    <details id={`faq-${entry.id}`} data-slot="faq-item" className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-4 py-3 font-medium sm:px-5 [&::-webkit-details-marker]:hidden">
        {t(entry.question)}
        <ChevronDownIcon aria-hidden="true" className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div data-slot="faq-answer" className="flex flex-col gap-3 px-4 pt-1 pb-4 sm:px-5">
        {entry.answer.map((key) => (
          <p key={key} className="max-w-prose">
            {t(key)}
          </p>
        ))}
        {link === undefined ? null : (
          <p>
            <a
              href={link.href}
              target="_blank"
              rel={NEW_TAB_REL}
              aria-label={`${t(link.label)} ${t('common.opensInNewTab')}`}
              className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
            >
              {t(link.label)}
              {/* Inline, so it follows the last word when the label wraps. */}
              <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-4 align-text-bottom" />
            </a>
          </p>
        )}
      </div>
    </details>
  );
}
