import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { usePorts, useWalletSlots, WALLET_ROLES } from '@/ports';

/**
 * Lets this browser forget every key it remembers: the Main key, Second key and New wallet slots and the second keys
 * remembered after a protect (D14). Disconnect on a slot clears only that slot, and /app shows the Main key slot alone,
 * so a key kept in another role had no way out here. Nothing changes on the chain. Hidden when nothing is remembered.
 */
export function ForgetKeys() {
  const { slots, secondKeys } = usePorts();
  const filled = useWalletSlots();
  const remembered = useSyncExternalStore(secondKeys.subscribe, secondKeys.getSnapshot);
  const anything = WALLET_ROLES.some((role) => filled[role] !== null) || remembered.length > 0;
  if (!anything) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3"
        onClick={() => {
          for (const role of WALLET_ROLES) slots.clear(role);
          for (const address of remembered) secondKeys.forget(address);
        }}
      >
        {t('app.forgetKeys.button')}
      </Button>
      <p className="max-w-prose text-sm text-muted">{t('app.forgetKeys.hint')}</p>
    </div>
  );
}
