import { ArrowRightIcon, KeyRoundIcon, PlusIcon, WalletIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { t, type MessageKey } from '@/i18n';

export type KeyRole = 'main' | 'second' | 'new';

const ROLE_NAME = {
  main: 'common.roles.main',
  second: 'common.roles.second',
  new: 'common.roles.new',
} as const satisfies Record<KeyRole, MessageKey>;

/** A key by its role, with the one name it has everywhere (UX rule 4): Main key, Second key, New wallet. */
export function RoleChip({ role }: { role: KeyRole }) {
  const Icon = role === 'new' ? WalletIcon : KeyRoundIcon;
  return (
    <Badge tone="outline" data-role={role}>
      <Icon aria-hidden="true" />
      {t(ROLE_NAME[role])}
    </Badge>
  );
}

/** "+" between keys that sign together. Hidden from screen readers: the text around a scheme says the same. */
export function PlusMark() {
  return <PlusIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted" />;
}

/** "Leads to" between the keys and what they do. Hidden from screen readers, like PlusMark. */
export function ArrowMark() {
  return <ArrowRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted" />;
}
