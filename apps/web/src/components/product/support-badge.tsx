import { cn } from 'cn';
import { CheckIcon, CircleQuestionMarkIcon, EyeOffIcon, TriangleAlertIcon, XIcon, type LucideIcon } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { t } from '@/i18n';

/**
 * What the wallet matrix found for a pair of wallets (landing "Which wallets work", DECISIONS.md D80). Static data:
 * no loading or error state; `not-verified` is the empty state, and every pair starts there.
 */
export type SupportVerdict = 'not-verified' | 'works' | 'works-with-warning' | 'blind-signing' | 'does-not-work';

type Look = { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon };

/** Word + colour + icon for each verdict (UX rule 5): colour is never the only signal. */
const LOOKS: Record<SupportVerdict, Look> = {
  'not-verified': { tone: 'outline', icon: CircleQuestionMarkIcon },
  works: { tone: 'success', icon: CheckIcon },
  'works-with-warning': { tone: 'warning', icon: TriangleAlertIcon },
  'blind-signing': { tone: 'warning', icon: EyeOffIcon },
  'does-not-work': { tone: 'danger', icon: XIcon },
};

export function SupportBadge({ verdict, className }: { verdict: SupportVerdict; className?: string | undefined }) {
  const { tone, icon: Icon } = LOOKS[verdict];
  return (
    // whitespace-normal overrides the Badge's nowrap: "Works, with a wallet warning" wraps at 360 px.
    <Badge tone={tone} size="md" data-verdict={verdict} className={cn('whitespace-normal', className)}>
      <Icon aria-hidden="true" />
      {t(`components.support.${verdict}`)}
    </Badge>
  );
}
