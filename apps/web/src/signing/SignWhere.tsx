import type { WalletRole } from '@stakeward/core';
import { useId } from 'react';
import { roleLabel } from '@/components/product/wallet-slot';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
 * The choice of where one key signs (CLAUDE.md section 6: live or by link), with what each way means. The page sets the
 * default; the link option can be turned off with the reason next to it.
 */
export function SignWhere({ role, value, onChange, disabledLink }: SignWhereProps) {
  const id = useId();
  const legendId = `${id}-legend`;
  const option = (mode: SignMode) => `${id}-${mode}`;
  const hint = (mode: SignMode) => `${id}-${mode}-hint`;
  const disabledId = `${id}-disabled`;
  const linkDisabled = disabledLink !== undefined;
  return (
    <fieldset data-slot="sign-where" className="flex flex-col gap-3">
      <legend id={legendId} className="mb-3 text-sm font-medium">
        {t('signing.where.legend', { role: roleLabel(role) })}
      </legend>
      <RadioGroup
        aria-labelledby={legendId}
        value={value}
        onValueChange={(next) => {
          if (next === 'here' || next === 'link') onChange(next);
        }}
      >
        <div className="flex items-start gap-3">
          <RadioGroupItem value="here" id={option('here')} aria-describedby={hint('here')} className="mt-0.5" />
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={option('here')}>{t('signing.where.here')}</Label>
            <p id={hint('here')} className="text-sm text-muted">
              {t('signing.where.hereHint')}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <RadioGroupItem
            value="link"
            id={option('link')}
            disabled={linkDisabled}
            aria-describedby={linkDisabled ? `${hint('link')} ${disabledId}` : hint('link')}
            className="mt-0.5"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={option('link')}>{t('signing.where.link')}</Label>
            <p id={hint('link')} className="text-sm text-muted">
              {t('signing.where.linkHint')}
            </p>
            {linkDisabled ? (
              <p id={disabledId} className="text-sm font-medium">
                {disabledLink}
              </p>
            ) : null}
          </div>
        </div>
      </RadioGroup>
    </fieldset>
  );
}
