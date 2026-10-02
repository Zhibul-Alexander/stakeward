import { CANNOT_DO_PATH, SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';

/** On every page (UX rule 12): source code, what Stakeward cannot do, no warranty (CLAUDE.md section 11). */
export function SiteFooter() {
  return (
    <footer className="border-t border-border print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted">
        <a className="rounded-sm underline underline-offset-4 hover:text-foreground" href={SOURCE_CODE_URL}>
          {t('footer.sourceCode')}
        </a>
        <a className="rounded-sm underline underline-offset-4 hover:text-foreground" href={CANNOT_DO_PATH}>
          {t('footer.cannotDo')}
        </a>
        <span>{t('footer.license')}</span>
      </div>
    </footer>
  );
}
