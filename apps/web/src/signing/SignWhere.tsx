import type { WalletRole } from '@stakeward/core';
import { RadioCardGroup } from '@/components/product/radio-card';
import { roleLabel } from '@/components/product/wallet-slot';
import { t } from '@/i18n';

/** Where a key signs: in this browser, or on another device through a /cosign link. */
export type SignMode = 'here' | 'link';

type SignWhereProps = {
  role: WalletRole;
  value: SignMode;
  onChange: (mode: SignMode) => void;
  /** Why signing by link is not possible here; the link option is then disabled and described by this text. */
  disabledLink?: string | undefined;
};

/**
 * The choice of where one key signs (CLAUDE.md section 6: live or by link), with what each way means, as two cards side
 * by side from 640 px (DECISIONS.md D109). The legend names the role, so the hints stay role-neutral (a rescue has
 * three wallets). The page sets the default; the link option can be turned off with the reason next to it.
 */
export function SignWhere({ role, value, onChange, disabledLink }: SignWhereProps) {
  return (
    <div data-slot="sign-where">
      <RadioCardGroup
        legend={t('signing.where.legend', { role: roleLabel(role) })}
        value={value}
        onValueChange={(next) => {
          if (next === 'here' || next === 'link') onChange(next);
        }}
        columns={2}
        options={[
          { value: 'here', title: t('signing.where.here'), description: t('signing.where.hereHint') },
          {
            value: 'link',
            title: t('signing.where.link'),
            description: t('signing.where.linkHint'),
            disabledReason: disabledLink,
          },
        ]}
      />
    </div>
  );
}
