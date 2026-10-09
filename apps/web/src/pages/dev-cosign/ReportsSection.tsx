import { FileTextIcon, Trash2Icon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { EmptyState } from '@/components/product/empty-state';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import type { ReportStore } from './report.ts';
import { CopyButton, ReportBlock } from './shared.tsx';

/** Step 6: every report of this browser, newest first, to paste into the matrix. */
export function ReportsSection({ reports }: { reports: ReportStore }) {
  const list = useSyncExternalStore(reports.subscribe, reports.getSnapshot);
  if (list.length === 0) {
    return (
      <EmptyState icon={FileTextIcon} title={t('devCosign.reports.emptyTitle')} headingLevel={3}>
        <p>{t('devCosign.reports.emptyBody')}</p>
      </EmptyState>
    );
  }
  const all = list.join('\n\n---\n\n');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={all} label={t('devCosign.reports.copyAll', { count: list.length })} />
        <Button variant="ghost" size="sm" onClick={reports.clear}>
          <Trash2Icon aria-hidden="true" />
          {t('devCosign.reports.clear')}
        </Button>
      </div>
      <ul className="flex flex-col gap-4">
        {list
          .map((text, index) => ({ text, n: index + 1 }))
          .reverse()
          .map(({ text, n }) => (
            <li key={n}>
              <ReportBlock text={text} label={t('devCosign.reports.numbered', { n })} />
            </li>
          ))}
      </ul>
    </div>
  );
}
