import { Link } from 'wouter';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';

/**
 * The top of /cosign: the h1 and "What is Stakeward?" (to the landing's card for someone sent a link). The lead says who
 * asks for what only while the link can be signed: above "Do not sign" or a link that no longer works it would
 * contradict the panel under it (DECISIONS.md D112).
 */
export function CosignHeader({ lead }: { lead: boolean }) {
  return (
    <PageHeader
      title={t('common.pages.cosign')}
      lead={lead ? t('cosign.intro') : undefined}
      meta={
        <p>
          <Link
            href="/#for-second-key"
            className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            {t('cosign.whatIs')}
          </Link>
        </p>
      }
    />
  );
}

/** The one way out of a page that cannot go on (UX rule 8): outline by default, ghost after a result. */
export function BackHome({ variant = 'outline' }: { variant?: 'outline' | 'ghost' }) {
  return (
    <Button asChild variant={variant}>
      <Link href="/">{t('common.backHome')}</Link>
    </Button>
  );
}
