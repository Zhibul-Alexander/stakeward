import { LinkIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { t } from '@/i18n';
import { HashLink } from './Section.tsx';

/**
 * For whoever was sent a link to co-sign and knows nothing else yet: /cosign's "What is Stakeward?" lands here
 * (`/#for-second-key`), and the link leads on to what to check (`#faq-co-sign`).
 */
export function CoSignCallout() {
  return (
    <section id="for-second-key" aria-labelledby="for-second-key-title" className="scroll-mt-4">
      <Alert tone="info" role="note" className="sm:px-6 sm:py-4">
        <LinkIcon aria-hidden="true" />
        <h2 id="for-second-key-title" className="text-lg font-semibold text-foreground">
          {t('landing.coSign.title')}
        </h2>
        <AlertDescription className="max-w-prose text-foreground sm:text-base">
          <p className="text-pretty">{t('landing.coSign.body')}</p>
          <p>
            <HashLink href="#faq-co-sign">{t('landing.coSign.more')}</HashLink>
          </p>
        </AlertDescription>
      </Alert>
    </section>
  );
}
