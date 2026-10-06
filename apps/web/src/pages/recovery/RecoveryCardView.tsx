import {
  CLI_ERROR_MESSAGES,
  cliUrl,
  formatSol,
  formatUtcDateTime,
  INSTALL_CLI_COMMAND,
  LAMPORTS_PER_SIGNATURE,
  LEDGER_PUBKEY_COMMAND,
  lockupEndForPeriod,
  MAX_LOCKUP_END,
  RECOVERY_CLI_VERSION,
  recoveryCommands,
  rfc3339Utc,
  type CliErrorKey,
  type Cluster,
  type RecoveryCommandId,
} from '@stakeward/core';
import { ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { ActivationBadge } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { CommandBlock } from '@/components/product/command-block';
import { RiskNote } from '@/components/product/risk-note';
import { SolAmount } from '@/components/product/sol-amount';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CLUSTER, SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';
import { appLinks } from '@/pages/app/view';
import { SUGGESTED_RESCUE_LAMPORTS } from '@/pages/rescue/wizard';
import { absoluteUrl, PrintedLink } from './PrintedLink.tsx';
import { accountsPath, type RecoveryCard } from './view.ts';

/** The Solana CLI install page (Windows, and every platform the installer script does not cover). */
const INSTALL_PAGE_URL = 'https://docs.anza.xyz/cli/install';

/** "If a command fails" explains every CLI message core lists, in its order. */
const ERROR_KEYS = Object.keys(CLI_ERROR_MESSAGES) as CliErrorKey[];

/** A lock end as the card says it: date and time in UTC (the reader may live in any time zone, DECISIONS.md D74). */
function dateTime(unixSeconds: bigint): string {
  return formatUtcDateTime(unixSeconds) ?? String(unixSeconds);
}

/** A `--lockup-date` that extends the earliest lock by 6 months, as the extend wizard would (RFC 3339, UTC). */
function newEndDateExample(earliestEnd: bigint): string {
  const base = earliestEnd > MAX_LOCKUP_END ? MAX_LOCKUP_END : earliestEnd;
  return rfc3339Utc(lockupEndForPeriod(base, 6)) ?? '';
}

/*
 * On paper, sections and cases may break across sheets: several are taller than a sheet, and keeping them whole pushes
 * them to a new sheet that splits them anyway, leaving a sheet nearly empty or a heading alone on one. Only their
 * heading stays with what follows it; the small blocks inside (commands, rows, notes) do not break.
 */

function CardSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-2xl font-semibold print:break-after-avoid">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Case({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-lg font-semibold print:break-after-avoid">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A numbered list of steps; the numbers come from the list, not from en.json. */
function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-3 pl-6 marker:font-semibold">{children}</ol>;
}

function KeyEntry({ role, address, note }: { role: string; address: string; note: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="font-medium">{role}</dt>
      <dd className="flex flex-col gap-1">
        <AddressText address={address} variant="full" explorer />
        <p className="text-sm text-muted">{note}</p>
      </dd>
    </div>
  );
}

type RecoveryCardViewProps = {
  card: RecoveryCard;
  /** The commands' `--url` and the devnet note follow the cluster of this build. */
  cluster?: Cluster | undefined;
};

/**
 * The recovery card (CLAUDE.md section 9, DECISIONS.md D74, D75 and D77), presentational so /dev/ui can show it: what
 * to check first, the two keys, the stake accounts it covers, the Solana command line steps for every case and what
 * no one can undo. Public addresses only; every key that signs a command is a placeholder the reader replaces. Printed
 * as it is on screen, without the page's header, footer and buttons.
 */
export function RecoveryCardView({ card, cluster = CLUSTER }: RecoveryCardViewProps) {
  const commands = recoveryCommands({ mainKeyAddress: card.mainKey, url: cliUrl(cluster) });
  const command = (id: RecoveryCommandId) => <CommandBlock argv={commands[id]} label={t(`recovery.commands.${id}`)} />;
  const example = newEndDateExample(card.earliestEnd);
  const managed = card.accounts.some((row) => row.staker !== null);

  return (
    <div data-slot="recovery-card" className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        {cluster === 'devnet' ? (
          <Alert tone="warning" role="note" className="print:break-inside-avoid">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription className="text-foreground">
              <p className="font-medium">{t('recovery.devnet')}</p>
            </AlertDescription>
          </Alert>
        ) : null}
        <p className="text-sm text-muted">{t('recovery.readAt', { date: dateTime(card.readAt) })}</p>
        <Alert tone="warning" role="note" data-slot="recovery-verify" className="print:break-inside-avoid">
          <ShieldAlertIcon aria-hidden="true" />
          <AlertTitle className="text-foreground">{t('recovery.verify.title')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p>{t('recovery.verify.body')}</p>
            <p>
              <PrintedLink href="/#faq-locked-by-other" label={t('recovery.links.lockedByOther')} />
            </p>
          </AlertDescription>
        </Alert>
      </div>

      <CardSection title={t('recovery.keys.title')}>
        <dl className="flex flex-col gap-4">
          <KeyEntry role={t('common.roles.main')} address={card.mainKey} note={t('recovery.keys.mainNote')} />
          <KeyEntry role={t('common.roles.second')} address={card.secondKey} note={t('recovery.keys.secondNote')} />
        </dl>
        <RiskNote risk="second-key-can-freeze" className="print:break-inside-avoid" />
      </CardSection>

      {card.expiringSoon ? (
        <RiskNote risk="lock-ends" date={card.earliestEnd} dateStyle="date-time" className="print:break-inside-avoid" />
      ) : null}

      <CardSection title={t('recovery.accounts.title')}>
        <p>{t('recovery.accounts.intro')}</p>
        <ul className="flex flex-col gap-3">
          {card.accounts.map((row) => (
            <li
              key={row.account.address}
              data-slot="recovery-account"
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 print:break-inside-avoid"
            >
              <AddressText address={row.account.address} variant="full" explorer />
              <div className="flex flex-wrap items-center gap-2">
                <SolAmount lamports={row.account.lamports} className="font-semibold" />
                <ActivationBadge status={row.activation} />
              </div>
              <p className="text-sm">{t('recovery.accounts.lockedUntil', { date: dateTime(row.lockUntil) })}</p>
              {row.staker === null ? null : (
                <div data-slot="managed-by" className="flex flex-col gap-1 text-sm">
                  <p>{t('recovery.accounts.managedBy')}</p>
                  <AddressText address={row.staker} variant="full" explorer />
                  <p className="font-medium">{t('recovery.accounts.managedByWarning')}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
        {card.others === 0 ? null : (
          <p className="text-sm">
            {card.others === 1 ? t('recovery.accounts.othersOne') : t('recovery.accounts.others', { count: card.others })}{' '}
            <PrintedLink href={accountsPath(card.mainKey)} label={t('recovery.accounts.othersLink')} />
          </p>
        )}
      </CardSection>

      <CardSection title={t('recovery.cli.title')}>
        <p>{t('recovery.cli.intro')}</p>
        <p>{t('recovery.cli.needs')}</p>
        <p className="text-sm text-muted">{t('recovery.cli.tested', { version: RECOVERY_CLI_VERSION })}</p>
        <p>{t('recovery.cli.install', { version: RECOVERY_CLI_VERSION })}</p>
        <CommandBlock argv={INSTALL_CLI_COMMAND} label={t('recovery.commands.install')} />
        <p>
          {t('recovery.cli.installHint', { version: RECOVERY_CLI_VERSION })}{' '}
          <PrintedLink href={INSTALL_PAGE_URL} label={t('recovery.links.install')} />
        </p>
        <p>{t('recovery.cli.stakeAccount')}</p>
        <p>{t('recovery.cli.keys')}</p>
        <p>{t('recovery.cli.ledger')}</p>
        <CommandBlock argv={LEDGER_PUBKEY_COMMAND} label={t('recovery.commands.ledger')} />
        <p>{t('recovery.cli.twoLedgers')}</p>
        <p>{t('recovery.cli.oneLine')}</p>
        <p>{t('recovery.cli.fees', { amount: formatSol(LAMPORTS_PER_SIGNATURE) })}</p>
        <p className="font-medium">
          {t('recovery.cli.noSeed')} {t('common.neverSeedPhrase')}
        </p>
      </CardSection>

      <CardSection title={t('recovery.cases.title')}>
        <Case title={t('recovery.cases.stolen.title')}>
          <p>{t('recovery.cases.stolen.body', { date: dateTime(card.earliestEnd) })}</p>
          <Steps>
            <li>{t('recovery.cases.stolen.time')}</li>
            <li>{t('recovery.cases.stolen.cleanDevice')}</li>
            <li>{t('recovery.cases.stolen.newWallet', { amount: formatSol(SUGGESTED_RESCUE_LAMPORTS) })}</li>
            <li className="space-y-2">
              <p>{t('recovery.cases.stolen.find')}</p>
              {command('find')}
            </li>
            <li>
              {t('recovery.cases.stolen.stakeward')}{' '}
              <PrintedLink href={appLinks.rescue(card.mainKey)} label={t('recovery.links.rescue')} />
            </li>
            <li className="space-y-2">
              <p>{t('recovery.cases.stolen.cli')}</p>
              {command('rescue')}
            </li>
          </Steps>
          <p>{t('recovery.cases.stolen.after')}</p>
          <p>{t('recovery.cases.stolen.restake')}</p>
        </Case>

        <Case title={t('recovery.cases.lostSecond.title')}>
          <p>{t('recovery.cases.lostSecond.body')}</p>
          <p>{t('recovery.cases.lostSecond.after')}</p>
          {command('withdraw-alone')}
          <p>{t('recovery.cases.lostSecond.reprotect')}</p>
        </Case>

        <Case title={t('recovery.cases.ending.title')}>
          <p>{t('recovery.cases.ending.body', { date: dateTime(card.earliestEnd) })}</p>
          {/* The link before the sentence that ends "Or run:", so that sentence leads straight into the command. */}
          <p>
            <PrintedLink href={appLinks.extend(card.route)} label={t('recovery.links.extend')} />
          </p>
          <p>{t('recovery.cases.ending.stakeward')}</p>
          {command('extend')}
          <p>{t('recovery.cli.date', { example })}</p>
          <p>{t('recovery.cases.ending.mainPays')}</p>
        </Case>

        <Case title={t('recovery.cases.withdraw.title')}>
          <RiskNote risk="withdraw-compromised" tone="danger" className="print:break-inside-avoid" />
          <Steps>
            <li className="space-y-2">
              <p>{t('recovery.cases.withdraw.deactivate')}</p>
              {command('deactivate')}
              {command('epoch')}
            </li>
            {managed ? <li>{t('recovery.cases.withdraw.managed')}</li> : null}
            <li className="space-y-2">
              <p>{t('recovery.cases.withdraw.withdraw')}</p>
              {command('withdraw')}
            </li>
          </Steps>
          <p>{t('recovery.cases.withdraw.remove')}</p>
          <RiskNote risk="unlock-opens-window" className="print:break-inside-avoid" />
          {command('remove-lock')}
          {command('withdraw-alone')}
        </Case>

        <Case title={t('recovery.cases.stolenSecond.title')}>
          <p>{t('recovery.cases.stolenSecond.body')}</p>
          {command('change-second-key')}
          <p>{t('recovery.cases.stolenSecond.late')}</p>
        </Case>

        <Case title={t('recovery.cases.down.title')}>
          <p>
            {t('recovery.cases.down.body')} <PrintedLink href={SOURCE_CODE_URL} label={t('recovery.links.source')} />
          </p>
          <p>{t('recovery.cases.down.browserOnly')}</p>
          <p>{t('recovery.cases.down.check')}</p>
          {command('show')}
        </Case>
      </CardSection>

      <CardSection title={t('recovery.errors.title')}>
        <p>{t('recovery.errors.intro')}</p>
        <dl className="flex flex-col gap-3">
          {ERROR_KEYS.map((key) => (
            <div key={key} data-cli-error={key} className="flex flex-col gap-1 print:break-inside-avoid">
              <dt>
                <code className="rounded-sm bg-subtle px-1 font-mono text-sm wrap-anywhere">{CLI_ERROR_MESSAGES[key]}</code>
              </dt>
              <dd className="text-sm">{t(`recovery.errors.${key}`, key === 'date' ? { example } : undefined)}</dd>
            </div>
          ))}
        </dl>
      </CardSection>

      <CardSection title={t('recovery.limits.title')}>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>{t('recovery.limits.mainLost')}</li>
          <li>{t('recovery.limits.mainLostStolen')}</li>
          <li>{t('recovery.limits.lostAndStolen')}</li>
          <li>{t('recovery.limits.bothLost')}</li>
          <li>{t('recovery.limits.bothStolen')}</li>
          <li>{t('recovery.limits.sameSeed')}</li>
        </ul>
      </CardSection>

      <div data-slot="card-footer" className="flex flex-col gap-1 border-t border-border pt-4 text-sm print:break-inside-avoid">
        <p>
          {t('recovery.printed.again')} <span className="font-mono break-all">{absoluteUrl(`/recovery/${card.route}`)}</span>
        </p>
        <p className="font-medium">{t('common.neverSeedPhrase')}</p>
        <p className="hidden print:block">{t('footer.license')}</p>
      </div>
    </div>
  );
}
