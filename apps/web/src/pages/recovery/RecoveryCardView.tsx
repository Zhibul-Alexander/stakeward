import {
  formatUtcDate,
  formatUtcDateTime,
  INSTALL_CLI_COMMAND,
  LEDGER_PUBKEY_COMMAND,
  RECOVERY_CLI_VERSION,
  type Cluster,
} from '@stakeward/core';
import { ShieldAlertIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { CommandBlock } from '@/components/product/command-block';
import { RiskNote } from '@/components/product/risk-note';
import { SolAmount } from '@/components/product/sol-amount';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import type { NoCardReason, RecoveryCard } from './card.ts';

/** Anchor of "Before you run a command", which the line above the first command points to. */
const BEFORE_ID = 'before-you-run';

type RecoveryCardViewProps = {
  card: RecoveryCard;
  cluster: Cluster;
  /** Cluster time of the read (unix seconds): when the card's facts were true. */
  readAt: bigint;
  /** Where this site lives (window.location.origin): the card prints the full address of each page it names. */
  siteOrigin: string;
};

/**
 * The recovery card of one locked stake account (CLAUDE.md section 9): its keys and lock end, then what to do in each
 * case, in Stakeward and with Solana CLI commands that work without Stakeward. No secrets: keys that sign stay
 * placeholders. Presentational (tests render it with fixtures); the page reads the account. Laid out for paper too:
 * buttons and the site frame are hidden in print, and print always uses the light theme (tokens.css).
 */
export function RecoveryCardView({ card, cluster, readAt, siteOrigin }: RecoveryCardViewProps) {
  const { account, commands } = card;
  const lockEnd = lockEndText(card);
  // A lock its epoch holds ends at no date the card can print; the texts then say "when the lock ends".
  const deadline = card.lockEpoch === null ? lockEnd : null;
  const riskDate = card.lockEpoch === null ? (card.lockUntil ?? undefined) : undefined;
  const mainKeyQuery = new URLSearchParams({ address: card.mainKey }).toString();

  return (
    <div data-slot="recovery-card" className="flex max-w-3xl flex-col gap-10">
      <p className="text-sm text-muted">
        {t('recovery.readOn', { network: t(`recovery.network.${cluster}`), date: formatUtcDateTime(readAt) ?? '' })}
      </p>

      <CardSection title={t('recovery.facts.title')}>
        <dl className="flex flex-col">
          <Fact term={t('recovery.facts.account')}>
            <AddressText address={account.address} variant="full" explorer cluster={cluster} />
          </Fact>
          <Fact term={t('recovery.facts.network')}>
            <p>{t(`recovery.network.${cluster}`)}</p>
          </Fact>
          <Fact term={t('recovery.facts.balance')}>
            <p>
              <SolAmount lamports={account.lamports} />
            </p>
          </Fact>
          <Fact term={t('common.roles.main')} note={t('recovery.facts.mainKeyNote')}>
            <AddressText address={card.mainKey} variant="full" explorer cluster={cluster} />
          </Fact>
          <Fact term={t('common.roles.second')} note={`${t('recovery.facts.secondKeyNote')} ${t('recovery.facts.secondKeyCheck')}`}>
            <AddressText address={card.secondKey} variant="full" explorer cluster={cluster} />
          </Fact>
          {card.staker === null ? null : (
            <Fact term={t('recovery.facts.staker')} note={t('recovery.facts.stakerNote')}>
              <AddressText address={card.staker} variant="full" explorer cluster={cluster} />
            </Fact>
          )}
          <Fact term={t('recovery.facts.lockEnds')}>
            <p className="font-medium">{lockEnd}</p>
          </Fact>
        </dl>
        <RiskNote risk="lose-second-key" date={riskDate} />
        <RiskNote risk="second-key-can-freeze" />
      </CardSection>

      <p className="max-w-prose font-medium">
        {t('recovery.needCli')}{' '}
        <a href={`#${BEFORE_ID}`} className="rounded-sm text-primary underline underline-offset-4 hover:text-primary-hover">
          {t('recovery.before.title')}
        </a>
      </p>

      <CardSection title={t('recovery.stolenMain.title')}>
        <p>{deadline === null ? t('recovery.stolenMain.bodyNoDate') : t('recovery.stolenMain.body', { date: deadline })}</p>
        <InStakeward text={t('recovery.stolenMain.stakeward')} path={`/rescue?${mainKeyQuery}`} siteOrigin={siteOrigin} />
        <p className="font-medium">{t('recovery.stolenMain.cli')}</p>
        <ol className="flex list-decimal flex-col gap-4 pl-5">
          <li>{t('recovery.stolenMain.step1')}</li>
          <li>{t('recovery.stolenMain.step2')}</li>
          <li className="flex flex-col gap-2">
            <p>{t('recovery.stolenMain.step3')}</p>
            <CommandBlock argv={commands.find} label={t('recovery.commands.find')} />
          </li>
          <li className="flex flex-col gap-2">
            <p>{t('recovery.stolenMain.step4')}</p>
            <CommandBlock argv={commands.rescue} label={t('recovery.commands.rescue')} />
          </li>
        </ol>
        <p>{t('recovery.stolenMain.after')}</p>
      </CardSection>

      <CardSection title={t('recovery.withdraw.title')}>
        <RiskNote risk="withdraw-compromised" />
        <InStakeward text={t('recovery.withdraw.stakeward')} path={`/withdraw/${account.address}`} siteOrigin={siteOrigin} />
        <p>{t('recovery.withdraw.deactivate')}</p>
        {card.staker === null ? null : <p>{t('recovery.withdraw.managed')}</p>}
        <CommandBlock argv={commands.deactivate} label={t('recovery.commands.deactivate')} />
        <CommandBlock argv={commands.epoch} label={t('recovery.commands.epoch')} />
        <p>{t('recovery.withdraw.withdraw')}</p>
        <CommandBlock argv={commands.withdraw} label={t('recovery.commands.withdraw')} />
      </CardSection>

      <CardSection title={t('recovery.extend.title')}>
        <InStakeward text={t('recovery.extend.stakeward')} path={`/extend/${account.address}`} siteOrigin={siteOrigin} />
        <p>{t('recovery.extend.body', { example: card.exampleEndDate })}</p>
        <CommandBlock argv={commands.extend} label={t('recovery.commands.extend')} />
        <p>{t('recovery.extend.remove')}</p>
        <CommandBlock argv={commands['remove-lock']} label={t('recovery.commands.removeLock')} />
      </CardSection>

      <CardSection title={t('recovery.stolenSecond.title')}>
        <p>{t('recovery.stolenSecond.body')}</p>
        <CommandBlock argv={commands['change-second-key']} label={t('recovery.commands.changeSecondKey')} />
        <p>{t('recovery.stolenSecond.after')}</p>
      </CardSection>

      <CardSection title={t('recovery.lostSecond.title')}>
        <p>{deadline === null ? t('recovery.lostSecond.bodyNoDate') : t('recovery.lostSecond.body', { date: deadline })}</p>
        <CommandBlock argv={commands['withdraw-alone']} label={t('recovery.commands.withdrawAlone')} />
      </CardSection>

      <CardSection id={BEFORE_ID} title={t('recovery.before.title')}>
        <p>{t('recovery.before.install', { version: RECOVERY_CLI_VERSION })}</p>
        <CommandBlock argv={INSTALL_CLI_COMMAND} label={t('recovery.commands.install')} />
        <p>{t('recovery.before.installWindows', { version: RECOVERY_CLI_VERSION })}</p>
        <p>{t('recovery.before.oneComputer')}</p>
        <p>{t('recovery.before.placeholders')}</p>
        <p>{t('recovery.before.ledger')}</p>
        <CommandBlock argv={LEDGER_PUBKEY_COMMAND} label={t('recovery.commands.ledger')} />
        <p>{t('recovery.before.feePayer')}</p>
        <p>{t('recovery.before.lines')}</p>
        <p className="font-medium">{t('recovery.before.seed')}</p>
        <p>{t('recovery.before.check')}</p>
        <CommandBlock argv={commands.show} label={t('recovery.commands.show')} />
      </CardSection>

      <CardSection title={t('recovery.noUndo.title')}>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>{t('recovery.noUndo.freeze')}</li>
          <li>{t('recovery.noUndo.notBackup')}</li>
          <li>{t('recovery.noUndo.both')}</li>
          <li>{t('recovery.noUndo.lostAndStolen')}</li>
        </ul>
      </CardSection>
    </div>
  );
}

/** Why there is no card, and the way forward: protect the account (F1), or back to the accounts. */
export function NoRecoveryCard({ reason, endedAt, mainKey }: { reason: NoCardReason; endedAt: bigint | null; mainKey: string }) {
  const endedOn = endedAt === null ? null : formatUtcDate(endedAt);
  const text =
    reason === 'no-lock'
      ? t('recovery.none.noLock')
      : reason === 'main-key-holds'
        ? t('recovery.none.mainKeyHolds')
        : endedOn === null
          ? t('recovery.none.endedNoDate')
          : t('recovery.none.ended', { date: endedOn });
  return (
    <Alert tone={reason === 'lock-ended' ? 'danger' : 'warning'} data-slot="no-recovery-card">
      <ShieldAlertIcon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-3 text-foreground">
        <p className="font-medium">{text}</p>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button asChild>
            <Link href="/protect">{t('common.pages.protect')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** The lock end in words: a UTC date and time, an epoch, or both. */
function lockEndText(card: RecoveryCard): string {
  const date =
    card.lockUntil === null
      ? null
      : (formatUtcDateTime(card.lockUntil) ?? t('recovery.facts.unixTime', { seconds: card.lockUntil.toString() }));
  if (card.lockEpoch === null) return date ?? '';
  const epoch = card.lockEpoch.toString();
  return date === null ? t('recovery.facts.lockEndEpoch', { epoch }) : t('recovery.facts.lockEndBoth', { date, epoch });
}

function CardSection({ id, title, children }: { id?: string | undefined; title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className="flex scroll-mt-4 flex-col gap-3">
      <h2 id={headingId} className="text-xl font-semibold print:break-after-avoid">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ term, note, children }: { term: string; note?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 first:pt-0 last:border-b-0 sm:flex-row sm:gap-6 print:break-inside-avoid">
      <dt className="shrink-0 font-medium sm:w-40">{term}</dt>
      <dd className="flex min-w-0 flex-1 flex-col gap-1">
        {children}
        {note === undefined ? null : <p className="text-sm text-muted">{note}</p>}
      </dd>
    </div>
  );
}

/**
 * "With Stakeward: <what the page does> <its full address>". The address is the link text, so a printed card still
 * says where to go.
 */
function InStakeward({ text, path, siteOrigin }: { text: string; path: string; siteOrigin: string }) {
  return (
    <p className="text-sm">
      <span className="font-medium">{t('recovery.openInStakeward')}</span> {text}{' '}
      <Link href={path} className="rounded-sm break-all text-primary underline underline-offset-4 hover:text-primary-hover">
        {new URL(path, siteOrigin).toString()}
      </Link>
    </p>
  );
}
