import { RefreshCwIcon, ShieldCheckIcon } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { AccountListSkeleton } from '@/components/product/account-row';
import { ActionBar } from '@/components/product/action-bar';
import { RiskNote } from '@/components/product/risk-note';
import { StepProgress } from '@/components/product/step-progress';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { ContinueButtons } from '@/pages/protect/StepButtons';
import { Demo, DemoGroup, DevSection } from './layout.tsx';

const noop = () => undefined;
/** 12 April 2027 00:00 UTC, as samples.ts (not imported here: it pulls core's builders into this eager chunk). */
const LOCK_END = 1_807_488_000n;

/** The page frame (DECISIONS.md D109): Page, PageHeader, Section and ActionBar with their optional parts. */
export function LayoutSection() {
  const steps = [t('devUi.sample.stepAccounts'), t('devUi.sample.stepSecondKey'), t('devUi.sample.stepPeriod'), t('devUi.sample.stepSign')];
  return (
    <DevSection id="layout" title={t('devUi.layout')}>
      <p className="max-w-prose text-base text-muted">{t('devUi.layoutNote')}</p>

      <DemoGroup title={t('devUi.names.page')}>
        <Demo label={t('devUi.states.withEverything')}>
          <div className="rounded-lg border border-border bg-background p-4">
            <Page width="flow">
              <PageHeader
                title={t('common.pages.protect')}
                lead={t('devUi.sample.pageLead')}
                meta={<p>{t('common.neverSeedPhrase')}</p>}
                back={{ href: '/dev/ui', label: t('common.backToAccounts') }}
                progress={<StepProgress steps={steps} current={1} />}
                action={
                  <Button variant="outline" size="sm">
                    <RefreshCwIcon aria-hidden="true" />
                    {t('app.results.refresh')}
                  </Button>
                }
              />
            </Page>
          </div>
        </Demo>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.section')}>
        <Demo label={t('devUi.states.normal')}>
          <Section
            title={t('devUi.sample.sectionTitle')}
            count={t('devUi.sample.sectionCount')}
            description={t('devUi.sample.sectionNote')}
            action={
              <Button variant="outline" size="sm">
                <ShieldCheckIcon aria-hidden="true" />
                {t('devUi.sample.protectTwo')}
              </Button>
            }
          >
            <AccountListSkeleton />
          </Section>
        </Demo>
      </DemoGroup>

      <DemoGroup title={t('devUi.names.actionBar')}>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <Demo label={t('devUi.states.withRisk')}>
            <ActionBar
              risk={<RiskNote risk="lose-second-key" date={LOCK_END} variant="inline" />}
              note={t('devUi.sample.firstSigner')}
              primary={<Button size="lg">{t('devUi.sample.signTwo')}</Button>}
              secondary={<Button variant="ghost">{t('common.back')}</Button>}
            />
          </Demo>
          <Demo label={t('devUi.states.blocked')}>
            <ContinueButtons
              label={t('devUi.sample.continueTwo')}
              problems={[t('protect.accounts.needMain')]}
              onContinue={noop}
              onBack={noop}
            />
          </Demo>
        </div>
      </DemoGroup>
    </DevSection>
  );
}
