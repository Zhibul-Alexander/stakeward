import { LinkIcon } from 'lucide-react';
import { t } from '@/i18n';
import { HashLink } from './Section.tsx';

/**
 * v10: for whoever was sent a link to co-sign (`/#for-second-key`, from /cosign). A dashed note pinned to the sheet,
 * in the Second key's colour: the reader is someone's second key.
 */
export function CoSignCallout() {
  return (
    <section
      id="for-second-key"
      aria-labelledby="for-second-key-title"
      className="grid scroll-mt-4 gap-3 rounded-lg border-2 border-dashed border-accent bg-accent-soft p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-5 sm:p-6"
    >
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-md bg-accent text-on-accent">
        <LinkIcon className="size-5" />
      </span>
      <div className="flex max-w-prose flex-col gap-2">
        <h2 id="for-second-key-title" className="font-display text-lg font-semibold">
          {t('landing.coSign.title')}
        </h2>
        <p className="text-base text-pretty">{t('landing.coSign.body')}</p>
        <p className="text-sm">
          <HashLink href="/learn/faq#faq-co-sign">{t('landing.coSign.more')}</HashLink>
        </p>
      </div>
    </section>
  );
}
