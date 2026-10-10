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
  RECOVERY_PLACEHOLDERS,
  recoveryCommands,
  rfc3339Utc,
  type CliErrorKey,
  type Cluster,
  type RecoveryCommandId,
} from '@stakeward/core';
import { cn } from 'cn';
import { KeyRoundIcon, ShieldAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ActivationText } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { CommandBlock } from '@/components/product/command-block';
import { keepTogether } from '@/components/product/countdown';
import { RiskNote } from '@/components/product/risk-note';
import { SolAmount } from '@/components/product/sol-amount';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CLUSTER, SOURCE_CODE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';
import { appLinks } from '@/pages/app/view';
import { SUGGESTED_RESCUE_LAMPORTS } from '@/pages/rescue/wizard';
import { absoluteUrl, PrintedLink } from './PrintedLink.tsx';
import { accountsPath, type RecoveryCard } from './view.ts';

/** The Solana CLI install page (Windows, and every platform the installer script does not cover). */
const INSTALL_PAGE_URL = 'https://docs.anza.xyz/cli/install';

/** "If a command fails" explains every CLI message core lists, in its order. */
const ERROR_KEYS = Object.keys(CLI_ERROR_MESSAGES) as CliErrorKey[];

/**
 * The six cases, in the card's order, by title. The index names each case by its whole title: a reader whose seed
 * phrase was seen may not think of the key as stolen, so the index keeps "or someone saw its seed phrase".
 */
const CASES = {
  stolen: 'recovery.cases.stolen.title',
  'lost-second': 'recovery.cases.lostSecond.title',
  ending: 'recovery.cases.ending.title',
  withdraw: 'recovery.cases.withdraw.title',
  'stolen-second': 'recovery.cases.stolenSecond.title',
  down: 'recovery.cases.down.title',
} as const satisfies Record<string, MessageKey>;

type CaseId = keyof typeof CASES;

const CASE_IDS = Object.keys(CASES) as CaseId[];

/** A case's anchor: the index links to it; its heading's id adds `-title`. */
const caseAnchor = (id: CaseId) => `recovery-case-${id}`;
const NEW_KEY_ANCHOR = 'recovery-new-key';
const BEFORE_CLI_ANCHOR = 'recovery-before-cli';

/** A lock end as the card says it: date and time in UTC (the reader may live in any time zone, DECISIONS.md D74). */
function dateTime(unixSeconds: bigint): string {
  return formatUtcDateTime(unixSeconds) ?? String(unixSeconds);
}

/** The same inside a sentence, on one line: a narrow screen must not split "before 29" / "October 2026". */
function dateTimeInSentence(unixSeconds: bigint): string {
  return keepTogether(dateTime(unixSeconds));
}

/** A `--lockup-date` that extends the earliest lock by 6 months, as the extend wizard would (RFC 3339, UTC). */
function newEndDateExample(earliestEnd: bigint): string {
  const base = earliestEnd > MAX_LOCKUP_END ? MAX_LOCKUP_END : earliestEnd;
  return rfc3339Utc(lockupEndForPeriod(base, 6)) ?? '';
}

/*
 * On paper, sections and cases may break across sheets: several are taller than a sheet, and keeping them whole pushes
 * them to a new sheet that splits them anyway, leaving a sheet nearly empty or a heading alone on one. Only their
 * heading stays with what follows it, and so does the sentence that leads into a command (Lead); the small blocks
 * inside (commands, rows, notes) do not break. Nothing on the card folds: closed content does not print.
 */

/** A link to a part of this card: underlined on screen, plain words on paper (nothing there to click). */
function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover print:font-normal print:text-foreground print:no-underline"
    >
      {children}
    </a>
  );
}

function CardSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <h2 id={`${id}-title`} className="text-lg font-semibold print:break-after-avoid">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * One case of "What to do": its situation, then Stakeward first and the command line second. Only steps done one after
 * another are numbered; an alternative ("Or, …") is never numbered as the next step.
 */
function Case({ id, children }: { id: CaseId; children: ReactNode }) {
  return (
    <section id={caseAnchor(id)} aria-labelledby={`${caseAnchor(id)}-title`} className="flex flex-col gap-3 border-t border-border pt-5">
      <h3 id={`${caseAnchor(id)}-title`} className="text-base font-semibold print:break-after-avoid">
        {t(CASES[id])}
      </h3>
      {children}
    </section>
  );
}

/**
 * The sentence that leads into the command after it ("…run:"). On paper it stays on that command's sheet: a command torn
 * from the words that say when to run it is worse than a page break before both.
 */
function Lead({ children }: { children: ReactNode }) {
  return <p className="print:break-after-avoid">{children}</p>;
}

/**
 * A command inside a numbered step: below 640 px it takes the full width under the step's number, so its lines wrap
 * less; from 640 px (paper included) it lines up with the step's words.
 */
const STEP_BLEED = '-ml-6 sm:ml-0';

/**
 * Commands on a phone: one step smaller (12 px), so an argument and its value stay on one line; copying is how a phone
 * reader takes them. From 640 px, and on paper, where they may be typed, they keep the block's own size.
 */
const PHONE_COMMAND = '[&_pre]:text-xs sm:[&_pre]:text-sm';

/**
 * A command-line option and the placeholder after it, as in "--custodian <SECOND_KEY>". A line may otherwise break after
 * "--" or inside the option, and a reader who types the halves apart gets an error.
 */
const OPTION = /(--[a-z][a-z-]*(?: <[A-Z_]+>)?)/;

/** Text that may name a command-line option: each option stays on one line. */
function WithOptions({ text }: { text: string }) {
  return text.split(OPTION).map((part, index) =>
    index % 2 === 1 ? (
      // Keyed by position: the parts of one fixed string, never reordered.
      <span key={index} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * A numbered list of steps; the numbers come from the list, not from en.json. A step that holds several blocks spaces
 * them with margins (`space-y-2`): a flex item would lose its list marker, and with it the step's number.
 */
function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-2.5 pl-6 marker:font-semibold marker:text-muted">{children}</ol>;
}

/** A step that ends in a command: its lead, then the command, kept together on paper. */
function CommandStep({ lead, children }: { lead: ReactNode; children: ReactNode }) {
  return (
    <li className="space-y-2">
      <Lead>{lead}</Lead>
      {children}
    </li>
  );
}

function KeyEntry({ role, address, note }: { role: string; address: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 print:break-inside-avoid">
      <dt className="font-semibold">{role}</dt>
      <dd className="flex flex-col gap-1">
        <AddressText address={address} variant="full" explorer />
        <p className="text-sm text-muted">{note}</p>
      </dd>
    </div>
  );
}

/** The placeholders that stand for a key that signs: each is a keypair file path or a Ledger URL. */
const KEY_PLACEHOLDERS = [
  RECOVERY_PLACEHOLDERS.mainKey,
  RECOVERY_PLACEHOLDERS.secondKey,
  RECOVERY_PLACEHOLDERS.newWallet,
  RECOVERY_PLACEHOLDERS.newSecondKey,
] as const;

/** The panel of a list on the card: one frame, rows divided by a hairline. */
const PANEL = 'divide-y divide-border rounded-lg border border-border bg-surface';

type RecoveryCardViewProps = {
  card: RecoveryCard;
  /** The commands' `--url` follow the cluster of this build. */
  cluster?: Cluster | undefined;
};

/**
 * The recovery card (CLAUDE.md section 9, DECISIONS.md D74, D75 and D77), presentational so /dev/ui can show it: what
 * to check first, the two keys, the stake accounts it covers, what to do in each of six cases (an index first), how to
 * run the Solana command line, what its errors mean and what no one can undo. Public addresses only; every key that
 * signs a command is a placeholder the reader replaces. Printed as it is on screen, without the page's header, footer
 * and buttons. The page's header above it says when the card was read and on which network.
 */
export function RecoveryCardView({ card, cluster = CLUSTER }: RecoveryCardViewProps) {
  const commands = recoveryCommands({ mainKeyAddress: card.mainKey, url: cliUrl(cluster) });
  const command = (id: RecoveryCommandId, inStep = true) => (
    <CommandBlock argv={commands[id]} label={t(`recovery.commands.${id}`)} className={cn(PHONE_COMMAND, inStep && STEP_BLEED)} />
  );
  const example = newEndDateExample(card.earliestEnd);
  const managed = card.accounts.some((row) => row.staker !== null);
  const newKeyRef = (
    <p>
      <CardLink href={`#${NEW_KEY_ANCHOR}`}>{t('recovery.cases.newKeyRef')}</CardLink>
    </p>
  );

  return (
    <div data-slot="recovery-card" className="flex flex-col gap-8 text-sm sm:text-base">
      <Alert tone="warning" role="note" data-slot="recovery-verify" className="print:break-inside-avoid">
        <ShieldAlertIcon aria-hidden="true" />
        <AlertTitle className="text-foreground">{t('recovery.verify.title')}</AlertTitle>
        <AlertDescription className="text-foreground">
          <p>{t('recovery.verify.body')}</p>
          <p>
            <PrintedLink href="/#faq-locked-by-other" label={t('recovery.links.lockedByOther')} />
          </p>
        </AlertDescription>
      </Alert>

      <CardSection id="recovery-keys" title={t('recovery.keys.title')}>
        <dl className={PANEL}>
          <KeyEntry role={t('common.roles.main')} address={card.mainKey} note={t('recovery.keys.mainNote')} />
          <KeyEntry role={t('common.roles.second')} address={card.secondKey} note={t('recovery.keys.secondNote')} />
        </dl>
        <RiskNote risk="second-key-can-freeze" variant="inline" className="print:break-inside-avoid" />
      </CardSection>

      <CardSection id="recovery-accounts" title={t('recovery.accounts.title')}>
        {card.expiringSoon ? (
          <RiskNote risk="lock-ends" date={card.earliestEnd} dateStyle="date-time" className="print:break-inside-avoid" />
        ) : null}
        <ul role="list" className={PANEL}>
          {card.accounts.map((row) => (
            <li key={row.account.address} data-slot="recovery-account" className="flex flex-col gap-1 px-4 py-3 print:break-inside-avoid">
              <AddressText address={row.account.address} variant="full" explorer />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <SolAmount lamports={row.account.lamports} className="font-semibold" />
                <ActivationText status={row.activation} />
                <span>{t('recovery.accounts.lockedUntil', { date: dateTime(row.lockUntil) })}</span>
              </div>
              {row.staker === null ? null : (
                <div data-slot="managed-by" className="mt-2 flex flex-col gap-1 rounded-md bg-subtle p-3 text-sm">
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

      <CardSection id="recovery-what-to-do" title={t('recovery.cases.title')}>
        <p>
          {t('recovery.cases.intro')} <CardLink href={`#${BEFORE_CLI_ANCHOR}`}>{t('recovery.cases.beforeCli')}</CardLink>
        </p>
        {/* Before the first command, where a phisher would ask for it; the card says it once. */}
        <p data-slot="recovery-no-seed" className="font-medium">
          {t('recovery.cases.noSeed')} {t('common.neverSeedPhrase')}
        </p>
        <nav aria-label={t('recovery.cases.index')} data-slot="recovery-index">
          <ul role="list" className="flex list-disc flex-col gap-1 pl-6 marker:text-muted">
            {CASE_IDS.map((id) => (
              <li key={id}>
                <CardLink href={`#${caseAnchor(id)}`}>{t(CASES[id])}</CardLink>
              </li>
            ))}
          </ul>
        </nav>
        <Alert tone="neutral" role="note" id={NEW_KEY_ANCHOR} data-slot="recovery-new-key" className="print:break-inside-avoid">
          <KeyRoundIcon aria-hidden="true" />
          <AlertTitle>{t('recovery.cases.newKey.title')}</AlertTitle>
          <AlertDescription>
            <p>
              {t('recovery.cases.newKey.body')} {t('recovery.cases.newKey.ledger')}
            </p>
          </AlertDescription>
        </Alert>

        <Case id="stolen">
          <p>{t('recovery.cases.stolen.body', { date: dateTimeInSentence(card.earliestEnd) })}</p>
          <Steps>
            <li>{t('recovery.cases.stolen.time')}</li>
            <li className="space-y-2">
              <p>{t('recovery.cases.stolen.newWallet', { amount: formatSol(SUGGESTED_RESCUE_LAMPORTS) })}</p>
              {newKeyRef}
            </li>
            {/* One step, two ways: Stakeward, or the command line without it. */}
            <li className="space-y-2">
              <p>
                {t('recovery.cases.stolen.stakeward')} <PrintedLink href={appLinks.rescue(card.mainKey)} label={t('recovery.links.rescue')} />
              </p>
              <Lead>{t('recovery.cases.stolen.find')}</Lead>
              {command('find')}
              <Lead>{t('recovery.cases.stolen.cli')}</Lead>
              {command('rescue')}
            </li>
            <li>{t('recovery.cases.stolen.after')}</li>
          </Steps>
          <p>{t('recovery.cases.stolen.restake')}</p>
        </Case>

        <Case id="lost-second">
          <p>{t('recovery.cases.lostSecond.body')}</p>
          <p>{t('recovery.cases.lostSecond.reprotect')}</p>
          <p>
            {t('recovery.cases.lostSecond.after')}{' '}
            <CardLink href={`#${caseAnchor('withdraw')}`}>{t('recovery.cases.lostSecond.afterRef')}</CardLink>
          </p>
        </Case>

        <Case id="ending">
          <p>{t('recovery.cases.ending.body', { date: dateTimeInSentence(card.earliestEnd) })}</p>
          <p>
            {t('recovery.cases.ending.stakeward')} <PrintedLink href={appLinks.extend(card.route)} label={t('recovery.links.extend')} />
          </p>
          <Lead>{t('recovery.cases.ending.cli')}</Lead>
          {command('extend', false)}
          <p>{t('recovery.cases.ending.date', { example })}</p>
          <p>
            <WithOptions text={t('recovery.cases.ending.mainPays')} />
          </p>
        </Case>

        <Case id="withdraw">
          <RiskNote risk="withdraw-compromised" tone="danger" variant="inline" className="print:break-inside-avoid" />
          <p>
            {t('recovery.cases.withdraw.stakeward')} <PrintedLink href={appLinks.withdraw(card.route)} label={t('recovery.links.withdraw')} />
          </p>
          <Steps>
            <li className="space-y-2">
              <Lead>{t('recovery.cases.withdraw.deactivate')}</Lead>
              {command('deactivate')}
              {command('epoch')}
            </li>
            {managed ? <li>{t('recovery.cases.withdraw.managed')}</li> : null}
            <CommandStep lead={t('recovery.cases.withdraw.withdraw')}>{command('withdraw')}</CommandStep>
          </Steps>
          {/* An alternative, not a next step: it opens a window for a thief, so its risk comes before its commands. */}
          <Lead>{t('recovery.cases.withdraw.remove')}</Lead>
          <RiskNote risk="unlock-opens-window" variant="inline" className="print:break-inside-avoid print:break-after-avoid" />
          {command('remove-lock', false)}
          {command('withdraw-alone', false)}
        </Case>

        <Case id="stolen-second">
          <p>{t('recovery.cases.stolenSecond.body')}</p>
          <Steps>
            <li className="space-y-2">
              <p>{t('recovery.cases.stolenSecond.newKey')}</p>
              {newKeyRef}
            </li>
            {/* One step, two ways: Stakeward, or the command line without it. */}
            <li className="space-y-2">
              <p>
                {t('recovery.cases.stolenSecond.stakeward')}{' '}
                <PrintedLink href={appLinks.changeKey(card.route)} label={t('recovery.links.changeKey')} />
              </p>
              <Lead>{t('recovery.cases.stolenSecond.cli')}</Lead>
              {command('change-second-key')}
            </li>
          </Steps>
          <p>{t('recovery.cases.stolenSecond.late')}</p>
        </Case>

        <Case id="down">
          <p>{t('recovery.cases.down.body')}</p>
          <p>
            {t('recovery.cases.down.source')} <PrintedLink href={SOURCE_CODE_URL} label={t('recovery.links.source')} />
          </p>
          <p>{t('recovery.cases.down.browserOnly')}</p>
          <Lead>{t('recovery.cases.down.check')}</Lead>
          {command('show', false)}
        </Case>
      </CardSection>

      <CardSection id={BEFORE_CLI_ANCHOR} title={t('recovery.cli.title')}>
        <ol className="flex list-decimal flex-col gap-4 pl-6 marker:font-semibold marker:text-muted">
          <li className="space-y-2">
            <Lead>{t('recovery.cli.install', { version: RECOVERY_CLI_VERSION })}</Lead>
            <CommandBlock argv={INSTALL_CLI_COMMAND} label={t('recovery.commands.install')} className={cn(PHONE_COMMAND, STEP_BLEED)} />
            <p className="text-sm">
              {t('recovery.cli.installHint', { version: RECOVERY_CLI_VERSION })}{' '}
              <PrintedLink href={INSTALL_PAGE_URL} label={t('recovery.links.install')} />
            </p>
          </li>
          <li className="space-y-2">
            <p>{t('recovery.cli.keys')}</p>
            <Lead>{t('recovery.cli.ledger')}</Lead>
            <CommandBlock argv={LEDGER_PUBKEY_COMMAND} label={t('recovery.commands.ledger')} className={cn(PHONE_COMMAND, STEP_BLEED)} />
          </li>
          <li className="space-y-2">
            <p className="print:break-after-avoid">{t('recovery.cli.placeholders')}</p>
            <dl className={cn(PANEL, 'text-sm print:break-inside-avoid')}>
              <Placeholder names={[RECOVERY_PLACEHOLDERS.stakeAccount]}>{t('recovery.cli.stakeAccount')}</Placeholder>
              <Placeholder names={KEY_PLACEHOLDERS}>{t('recovery.cli.keyPath')}</Placeholder>
            </dl>
          </li>
          <li>
            <WithOptions text={t('recovery.cli.fees', { amount: formatSol(LAMPORTS_PER_SIGNATURE) })} />
          </li>
        </ol>
        <p className="text-sm">{t('recovery.cli.oneLine')}</p>
        <div className="flex flex-col gap-1 text-sm text-muted">
          <p>{t('recovery.cli.tested', { version: RECOVERY_CLI_VERSION })}</p>
          <p>{t('recovery.cli.untestedLedger')}</p>
        </div>
      </CardSection>

      <CardSection id="recovery-errors" title={t('recovery.errors.title')}>
        <dl className={PANEL}>
          {ERROR_KEYS.map((key) => (
            <div key={key} data-cli-error={key} className="px-4 py-2 print:break-inside-avoid">
              {/*
               * Message and meaning run on in one paragraph. The message has its own background (on each of its lines), so
               * where it ends shows even when the meaning starts on the same line.
               */}
              <dt className="mr-2 inline">
                <code className="rounded-sm bg-subtle box-decoration-clone px-1 font-mono wrap-anywhere">{CLI_ERROR_MESSAGES[key]}</code>
              </dt>
              <dd className="inline text-muted">
                <WithOptions text={t(`recovery.errors.${key}`, key === 'date' ? { example } : undefined)} />
              </dd>
            </div>
          ))}
        </dl>
      </CardSection>

      <CardSection id="recovery-limits" title={t('recovery.limits.title')}>
        <ul className="flex list-disc flex-col gap-2 pl-6 marker:text-muted">
          <li>{t('recovery.limits.mainLost')}</li>
          <li>{t('recovery.limits.mainLostStolen')}</li>
          <li>{t('recovery.limits.lostAndStolen')}</li>
          <li>{t('recovery.limits.bothLost')}</li>
          <li>{t('recovery.limits.bothStolen')}</li>
          <li className="font-medium">{t('recovery.limits.sameSeed')}</li>
        </ul>
      </CardSection>

      <div data-slot="card-footer" className="flex flex-col gap-1 border-t border-border pt-4 text-sm print:break-inside-avoid">
        <p>
          {t('recovery.printed.again')} <span className="font-mono break-all">{absoluteUrl(`/recovery/${card.route}`)}</span>
        </p>
        <p className="hidden print:block">{t('footer.license')}</p>
      </div>
    </div>
  );
}

/** One row of the placeholder table: the placeholders (as the commands write them) and what replaces them. */
function Placeholder({ names, children }: { names: readonly string[]; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
      <dt className="flex flex-wrap gap-x-2 gap-y-1 sm:w-48 sm:shrink-0">
        {names.map((name) => (
          <code key={name} className="font-mono wrap-anywhere">
            {name}
          </code>
        ))}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
