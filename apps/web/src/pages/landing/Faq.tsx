import { ChevronDownIcon } from 'lucide-react';
import { FaqItem } from '@/components/product/faq-item';
import { GATE_RESULTS_URL } from '@/config';
import { t } from '@/i18n';
import { FAQ_EXTRAS, FAQ_GROUPS, type FaqId } from './faq.ts';
import { ExternalLink, HashLink, PageLink, Section } from './Section.tsx';
import { LEDGER_CHECKED_ON, LEDGER_SCREENS, matrixDateText } from './wallet-support.ts';

/** An FAQ answer: one paragraph per blank-line-separated block of its en.json text. */
export function FaqAnswer({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </>
  );
}

/**
 * "What will my Ledger show?": the fields the Ledger Solana app shows for each kind of Stakeward transaction, known from
 * its source code until a device has shown them (LEDGER_CHECKED_ON, DECISIONS.md D80).
 */
function LedgerScreens() {
  const checkedOn = matrixDateText(LEDGER_CHECKED_ON);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">{checkedOn === null ? t('faq.ledger.fromSource') : t('faq.ledger.checkedOn', { date: checkedOn })}</p>
      {LEDGER_SCREENS.map((screen) => (
        <div key={screen.action} className="flex flex-col gap-1">
          <h4 className="font-semibold">{t(`faq.ledger.actions.${screen.action}`)}</h4>
          {/* Each field on one flowing line, the device's label first: a phone keeps the list short. */}
          <dl className="flex flex-col gap-1">
            {screen.fields.map((field) => (
              <div key={field}>
                <dt className="mr-2 inline font-mono font-medium">{t(`faq.ledger.fields.${field}.label`)}</dt>
                <dd className="inline">{t(`faq.ledger.fields.${field}.meaning`)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <p>{t('faq.ledger.authorizedBy')}</p>
      <p>{t('faq.ledger.withdrawNote')}</p>
      <p>{t('faq.ledger.phantom')}</p>
      <p>
        <HashLink href="#faq-terms">{t('faq.ledger.termsLink')}</HashLink>
      </p>
    </div>
  );
}

function Extra({ item }: { item: FaqId }) {
  const extra = FAQ_EXTRAS[item];
  if (extra === 'ledger') return <LedgerScreens />;
  if (extra === 'gate-link') {
    return (
      <p>
        <ExternalLink href={GATE_RESULTS_URL} label={t('faq.gateLink')} />
      </p>
    );
  }
  if (extra === 'rescue-link') {
    // Rescue asks for the main key on its first step, so the link carries no address.
    return (
      <p>
        <PageLink href="/rescue">{t('faq.rescueLink')}</PageLink>
      </p>
    );
  }
  return null;
}

/**
 * Questions and answers (en.json `faq`, the one place besides the recovery card where the program's words custodian,
 * withdrawer and staker appear, D81), in five closed groups. A group is a native <details> whose summary holds its h3
 * and how many questions it has; inside, each question is a <details> with the id `faq-<question>`, so a link to
 * `/#faq-ledger` opens it and its group (useHashTarget).
 */
export function Faq({ params }: { params: Readonly<Record<string, string>> }) {
  return (
    <Section id="faq" title={t('faq.title')}>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {FAQ_GROUPS.map((group) => (
          <details key={group.id} data-slot="faq-group" className="group/faq-group px-4 sm:px-6">
            <summary className="summary-plain relative flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-sm py-2.5 pr-8 sm:py-3">
              <h3 className="text-base font-semibold">{t(`faq.groups.${group.id}`)}</h3>
              {/* Below 640 px the count is read out but not shown: it would take a line of its own under long names. */}
              <span className="sr-only text-sm text-muted tabular-nums sm:not-sr-only">{t('faq.groupCount', { count: group.items.length })}</span>
              <ChevronDownIcon
                aria-hidden="true"
                className="absolute top-1/2 right-0 size-4 -translate-y-1/2 text-muted transition-transform group-open/faq-group:rotate-180"
              />
            </summary>
            <div className="flex flex-col divide-y divide-border border-t border-border">
              {group.items.map((item) => (
                <FaqItem key={item} id={`faq-${item}`} question={t(`faq.items.${item}.q`)} className="scroll-mt-4">
                  <FaqAnswer text={t(`faq.items.${item}.a`, params)} />
                  <Extra item={item} />
                </FaqItem>
              ))}
            </div>
          </details>
        ))}
      </div>
    </Section>
  );
}
