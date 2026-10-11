import { LinkIcon } from 'lucide-react';
import { t } from '@/i18n';
import { HashLink } from './Section.tsx';

/**
 * For whoever was sent a link to co-sign and knows nothing else yet: /cosign's "What is Stakeward?" lands here
 * (`/#for-second-key`). v7: a quiet aside with the info tone's rail.
 */
export function CoSignCallout() {
  return (
    <section
      id="for-second-key"
      aria-labelledby="for-second-key-title"
      role="note"
      className="flex scroll-mt-4 flex-col gap-3 rounded-r-xl border-l-4 border-info bg-info-soft px-5 py-5 sm:flex-row sm:items-start sm:gap-5 sm:px-8"
    >
      <LinkIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-info" />
      <div className="flex max-w-prose flex-col gap-2">
        <h2 id="for-second-key-title" className="text-lg font-semibold text-foreground">
          {t('landing.coSign.title')}
        </h2>
        <p className="text-base text-pretty">{t('landing.coSign.body')}</p>
        <p>
          <HashLink href="/learn/faq#faq-co-sign">{t('landing.coSign.more')}</HashLink>
        </p>
      </div>
    </section>
  );
}
