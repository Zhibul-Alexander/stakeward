import { LinkIcon } from 'lucide-react';
import { t } from '@/i18n';
import { HashLink } from './Section.tsx';

/**
 * For whoever was sent a link to co-sign and knows nothing else yet: /cosign's "What is Stakeward?" lands here
 * (`/#for-second-key`), and the link leads on to what to check (`#faq-co-sign`). A companion bubble in this variant.
 */
export function CoSignCallout() {
  return (
    <section id="for-second-key" aria-labelledby="for-second-key-title" className="scroll-mt-4">
      <div role="note" className="flex flex-col gap-4 rounded-2xl bg-sky p-5 sm:flex-row sm:items-start sm:gap-6 sm:p-8">
        <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-surface text-sky-ink shadow-md">
          <LinkIcon className="size-6" />
        </span>
        <div className="flex max-w-prose flex-col gap-2">
          <h2 id="for-second-key-title" className="text-2xl text-foreground">
            {t('landing.coSign.title')}
          </h2>
          <p className="text-base text-pretty text-foreground">{t('landing.coSign.body')}</p>
          <p>
            <HashLink href="/learn/faq#faq-co-sign">{t('landing.coSign.more')}</HashLink>
          </p>
        </div>
      </div>
    </section>
  );
}
