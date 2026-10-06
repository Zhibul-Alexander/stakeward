import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';
import { HashLink, Section } from './Section.tsx';

/**
 * The three people Stakeward is for (CLAUDE.md section 9). The last card is where /cosign's "What is Stakeward?" lands
 * (`/#for-second-key`): someone who got a link to co-sign and knows nothing else yet.
 */
export function WhoFor() {
  return (
    <Section id="who" title={t('landing.who.title')}>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle asChild>
              <h3>{t('landing.who.holder.title')}</h3>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{t('landing.who.holder.body')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle asChild>
              <h3>{t('landing.who.team.title')}</h3>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{t('landing.who.team.body')}</p>
          </CardContent>
        </Card>
        <Card id="for-second-key" className="scroll-mt-4">
          <CardHeader>
            <CardTitle asChild>
              <h3>{t('landing.who.secondKeyHolder.title')}</h3>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>{t('landing.who.secondKeyHolder.body')}</p>
            <p>
              <HashLink href="#faq-co-sign">{t('landing.who.secondKeyHolder.more')}</HashLink>
            </p>
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}
