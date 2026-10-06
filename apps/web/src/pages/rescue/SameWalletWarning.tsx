import { TriangleAlertIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { t } from '@/i18n';

/** The new wallet's wallet app (its name) also holds these keys (SECURITY-CHECK П5, wizard.ts newWalletSharesWallet). */
export type SameWallet = { wallet: string; roles: readonly ('main' | 'second')[] };

/**
 * The warning on every rescue step that connects a key, when the new wallet shares a wallet app with the main key or the
 * second key: probably one seed phrase. `action` is what the user does next on that step: press Continue, or sign.
 */
export function SameWalletWarning({ sameWallet, action }: { sameWallet: SameWallet; action: 'continue' | 'sign' }) {
  return (
    <Alert tone="warning" role="note">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-1 text-foreground">
        {sameWallet.roles.map((role) => (
          <p key={role} className="font-medium">
            {t(`rescue.newWallet.sameWallet.${role}`, { wallet: sameWallet.wallet })}
          </p>
        ))}
        <p>{action === 'continue' ? t('rescue.newWallet.sameWallet.seed') : t('rescue.newWallet.sameWallet.seedSign')}</p>
      </AlertDescription>
    </Alert>
  );
}
