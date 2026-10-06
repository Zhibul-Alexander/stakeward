import {
  formatUtcDate,
  formatUtcDateTime,
  INSTALL_CLI_COMMAND,
  LEDGER_PUBKEY_COMMAND,
  RECOVERY_CLI_VERSION,
  type Cluster,
} from '@stakeward/core';
import { ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { CommandBlock } from '@/components/product/command-block';
import { RiskNote, riskText } from '@/components/product/risk-note';
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
 * buttons and the site frame are hidden in print, a sentence stays on the page of its command, and print always uses
 * the light theme (tokens.css). The guidance follows README "Recover without Stakeward".
 */
export function RecoveryCardView({ card, cluster, readAt, siteOrigin }: RecoveryCardViewProps) {
  const { account, commands } = card;
  const lockEnd = lockEndText(card);
  // A lock its epoch holds ends at no date the card can print, and the card's commands only change a lock's date:
  // the texts then say "when the lock ends", and extending or removing the lock is not offered (as on /extend).
  const byDate = card.lockEpoch === null;
  const deadline = byDate ? lockEnd : null;
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
        {byDate && card.lockUntil !== null && riskText('lose-second-key', card.lockUntil) !== null ? (
          <RiskNote risk="lose-second-key" date={card.lockUntil} />
        ) : (
          <Alert tone="warning" role="note" data-risk="lose-second-key">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertDescription className="text-foreground">
              <p className="font-medium">{t('recovery.facts.loseSecondKeyNoDate')}</p>
            </AlertDescription>
          </Alert>
        )}
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
          {byDate ? <li>{t('recovery.stolenMain.extendFirst')}</li> : null}
          <li>{t('recovery.stolenMain.step2')}</li>
          <li>
            <CommandStep text={t('recovery.stolenMain.step3')} argv={commands.find} label={t('recovery.commands.find')} />
          </li>
          <li>
            <CommandStep text={t('recovery.stolenMain.step4')} argv={commands.rescue} label={t('recovery.commands.rescue')} />
          </li>
        </ol>
        <p>{t('recovery.stolenMain.after')}</p>
      </CardSection>

      <CardSection title={t('recovery.withdraw.title')}>
        <RiskNote risk="withdraw-compromised" />
        <InStakeward text={t('recovery.withdraw.stakeward')} path={`/withdraw/${account.address}`} siteOrigin={siteOrigin} />
        {card.staker === null ? null : <p>{t('recovery.withdraw.managed')}</p>}
        <CommandStep text={t('recovery.withdraw.deactivate')} argv={commands.deactivate} label={t('recovery.commands.deactivate')}>
          <CommandBlock argv={commands.epoch} label={t('recovery.commands.epoch')} />
        </CommandStep>
        <CommandStep text={t('recovery.withdraw.withdraw')} argv={commands.withdraw} label={t('recovery.commands.withdraw')} />
      </CardSection>

      <CardSection title={t('recovery.extend.title')}>
        {byDate ? (
          <>
            <InStakeward text={t('recovery.extend.stakeward')} path={`/extend/${account.address}`} siteOrigin={siteOrigin} />
            <CommandStep
              text={t('recovery.extend.body', { example: card.exampleEndDate })}
              argv={commands.extend}
              label={t('recovery.commands.extend')}
            />
            <CommandStep text={t('recovery.extend.remove')} argv={commands['remove-lock']} label={t('recovery.commands.removeLock')}>
              <CommandBlock argv={commands['withdraw-alone']} label={t('recovery.commands.withdrawAlone')} />
            </CommandStep>
          </>
        ) : (
          <p>{t('recovery.extend.epoch', { epoch: String(card.lockEpoch) })}</p>
        )}
      </CardSection>

      <CardSection title={t('recovery.stolenSecond.title')}>
        {/* /second-key changes the key of a lock that ends on a date only (as /extend); the command works for both. */}
        {byDate ? (
          <InStakeward text={t('recovery.stolenSecond.stakeward')} path={`/second-key/${account.address}`} siteOrigin={siteOrigin} />
        ) : null}
        <CommandStep
          text={t('recovery.stolenSecond.body')}
          argv={commands['change-second-key']}
          label={t('recovery.commands.changeSecondKey')}
        />
        <p>{t('recovery.stolenSecond.after')}</p>
      </CardSection>

      <CardSection title={t('recovery.lostSecond.title')}>
        <CommandStep
          text={deadline === null ? t('recovery.lostSecond.bodyNoDate') : t('recovery.lostSecond.body', { date: deadline })}
          argv={commands['withdraw-alone']}
          label={t('recovery.commands.withdrawAlone')}
        />
      </CardSection>

      <CardSection id={BEFORE_ID} title={t('recovery.before.title')}>
        <CommandStep
          text={t('recovery.before.install', { version: RECOVERY_CLI_VERSION })}
          argv={INSTALL_CLI_COMMAND}
          label={t('recovery.commands.install')}
        />
        <p>{t('recovery.before.installWindows', { version: RECOVERY_CLI_VERSION })}</p>
        <p>{t('recovery.before.oneComputer')}</p>
        <p>{t('recovery.before.placeholders')}</p>
        <CommandStep text={t('recovery.before.ledger')} argv={LEDGER_PUBKEY_COMMAND} label={t('recovery.commands.ledger')} />
        <p>{t('recovery.before.feePayer')}</p>
        <p>{t('recovery.before.lines')}</p>
        <p className="font-medium">{t('recovery.before.seed')}</p>
        <CommandStep text={t('recovery.before.check')} argv={commands.show} label={t('recovery.commands.show')} />
      </CardSection>

      <CardSection title={t('recovery.noUndo.title')}>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>{t('recovery.noUndo.freeze')}</li>
          <li>{t('recovery.noUndo.notBackup')}</li>
          <li>{t('recovery.noUndo.keepExtending')}</li>
          <li>{t('recovery.noUndo.both')}</li>
          <li>{t('recovery.noUndo.lostAndStolen')}</li>
          <li>{t('recovery.noUndo.oneSeed')}</li>
        </ul>
      </CardSection>
    </div>
  );
}

type NoRecoveryCardProps = {
  /** The stake account, preselected on /protect. */
  account: string;
  reason: NoCardReason;
  /** When the lock ended (`lock-ended`) or ends (`nobody-holds`), unix seconds; null when there is no such date. */
  date: bigint | null;
  mainKey: string;
};

/** Why there is no card, and the way forward: protect the account (F1), or back to the accounts. */
export function NoRecoveryCard({ account, reason, date, mainKey }: NoRecoveryCardProps) {
  const day = date === null ? null : formatUtcDate(date);
  return (
    <Alert tone={reason === 'lock-ended' ? 'danger' : 'warning'} data-slot="no-recovery-card">
      <ShieldAlertIcon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-3 text-foreground">
        <p className="font-medium">{noCardText(reason, day)}</p>
        <div className="flex flex-wrap gap-2 print:hidden">
          {reason === 'nobody-holds' ? null : (
            <Button asChild>
              <Link href={`/protect?${new URLSearchParams({ account }).toString()}`}>{t('common.pages.protect')}</Link>
            </Button>
          )}
          <Button asChild variant={reason === 'nobody-holds' ? 'primary' : 'outline'}>
            <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function noCardText(reason: NoCardReason, day: string | null): string {
  switch (reason) {
    case 'no-lock':
      return t('recovery.none.noLock');
    case 'main-key-holds':
      return t('recovery.none.mainKeyHolds');
    case 'lock-ended':
      return day === null ? t('recovery.none.endedNoDate') : t('recovery.none.ended', { date: day });
    case 'nobody-holds':
      return day === null ? t('recovery.none.nobodyHoldsNoDate') : t('recovery.none.nobodyHolds', { date: day });
  }
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

/**
 * A sentence and the command it introduces (and, as children, a command that goes with it), kept on one printed page:
 * a command torn from the words that say when to run it is worse than a page break before both.
 */
function CommandStep({ text, argv, label, children }: { text: string; argv: readonly string[]; label: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 print:break-inside-avoid">
      <p>{text}</p>
      <CommandBlock argv={argv} label={label} />
      {children}
    </div>
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
 * says where to go; it wraps only where it must.
 */
function InStakeward({ text, path, siteOrigin }: { text: string; path: string; siteOrigin: string }) {
  return (
    <p className="text-sm">
      <span className="font-medium">{t('recovery.openInStakeward')}</span> {text}{' '}
      <Link href={path} className="rounded-sm text-primary underline underline-offset-4 wrap-anywhere hover:text-primary-hover">
        {new URL(path, siteOrigin).toString()}
      </Link>
    </p>
  );
}
