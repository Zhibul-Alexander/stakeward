import { LinkIcon } from 'lucide-react';
import { t } from '@/i18n';
import { HashLink } from './Section.tsx';

/**
 * For whoever was sent a link to co-sign: an inverted ink block, so it reads as a different voice from the rest of the
 * page. /cosign's "What is Stakeward?" lands here (`/#for-second-key`).
 */
export function CoSignCallout() {
  return (
    <section
      id="for-second-key"
      aria-labelledby="for-second-key-title"
      role="note"
      className="ink-block grid scroll-mt-4 gap-4 p-5 sm:p-8 md:grid-cols-12 md:gap-x-6"
    >
      <div className="flex items-start gap-3 md:col-span-5">
        <LinkIcon aria-hidden="true" className="mt-1 size-6 shrink-0" strokeWidth={2.5} />
        <h2 id="for-second-key-title" className="text-2xl uppercase sm:text-3xl md:text-2xl lg:text-[2.25rem] lg:leading-[1]">
          {t('landing.coSign.title')}
        </h2>
      </div>
      <div className="flex max-w-prose flex-col gap-3 text-base md:col-span-7">
        <p className="text-pretty">{t('landing.coSign.body')}</p>
        <p>
          <HashLink href="/learn/faq#faq-co-sign">{t('landing.coSign.more')}</HashLink>
        </p>
      </div>
    </section>
  );
}
