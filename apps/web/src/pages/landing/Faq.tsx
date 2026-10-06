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
          <dl className="flex flex-col gap-1">
            {screen.fields.map((field) => (
              <div key={field} className="flex flex-col sm:flex-row sm:gap-3">
                <dt className="font-mono sm:shrink-0">{t(`faq.ledger.fields.${field}.label`)}</dt>
                <dd>{t(`faq.ledger.fields.${field}.meaning`)}</dd>
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
 * withdrawer and staker appear, D81). Each question is a native <details> with the id `faq-<question>`, so a link to
 * `/#faq-ledger` opens it (useHashTarget).
 */
export function Faq({ params }: { params: Readonly<Record<string, string>> }) {
  return (
    <Section id="faq" title={t('faq.title')}>
      {FAQ_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold">{t(`faq.groups.${group.id}`)}</h3>
          <div className="flex flex-col gap-2">
            {group.items.map((item) => (
              <FaqItem key={item} id={`faq-${item}`} question={t(`faq.items.${item}.q`)} className="scroll-mt-4">
                <FaqAnswer text={t(`faq.items.${item}.a`, params)} />
                <Extra item={item} />
              </FaqItem>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}
