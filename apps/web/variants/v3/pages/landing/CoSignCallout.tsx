import { LinkIcon } from 'lucide-react';
import { t } from '@/i18n';
import { HashLink } from './Section.tsx';

/**
 * Variant v3: a boxed sidebar for whoever was sent a link to co-sign (`/#for-second-key`), set like a magazine's
 * "if you only read one thing" box: an ink frame, the heading in the display serif.
 */
export function CoSignCallout() {
  return (
    <section
      id="for-second-key"
      aria-labelledby="for-second-key-title"
      className="scroll-mt-4"
    >
      <div role="note" className="flex flex-col gap-3 border-2 border-rule bg-surface p-5 sm:p-7">
      <LinkIcon aria-hidden="true" className="size-5 text-accent-ink" />
      <h2 id="for-second-key-title" className="text-[2rem] leading-[1.05] text-balance">
        {t('landing.coSign.title')}
      </h2>
      <p className="max-w-[34rem] text-base text-pretty">{t('landing.coSign.body')}</p>
      <p>
        <HashLink href="/learn/faq#faq-co-sign">{t('landing.coSign.more')}</HashLink>
      </p>
      </div>
    </section>
  );
}
