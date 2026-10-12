import { LinkIcon } from 'lucide-react';
import { t } from '@/i18n';

/**
 * v12: for whoever was sent a link to co-sign and knows nothing else yet (`/#for-second-key`, from /cosign). An info
 * panel: it is a role, not an alarm.
 */
export function CoSignCallout() {
  return (
    <section
      id="for-second-key"
      aria-labelledby="for-second-key-title"
      role="note"
      className="flex scroll-mt-4 flex-col gap-3 rounded-lg border border-info-border bg-info-soft p-4 sm:flex-row sm:gap-4 sm:p-5"
    >
      <LinkIcon aria-hidden="true" className="size-5 shrink-0 text-info" />
      <div className="flex flex-col gap-2">
        <h2 id="for-second-key-title" className="text-lg font-bold text-foreground">
          {t('landing.coSign.title')}
        </h2>
        <p className="max-w-prose text-base text-pretty text-foreground">{t('landing.coSign.body')}</p>
        <p>
          <a href="/learn/faq#faq-co-sign" className="rounded-sm font-semibold text-foreground underline underline-offset-4 hover:decoration-2">
            {t('landing.coSign.more')}
          </a>
        </p>
      </div>
    </section>
  );
}
