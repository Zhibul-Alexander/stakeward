import {
  cliUrl,
  formatSol,
  lockupEndForPeriod,
  RECOVERY_CLI_VERSION,
  RECOVERY_PLACEHOLDERS,
  recoveryCommands,
  rfc3339Utc,
  type Cluster,
  type RecoveryCommandId,
} from '@stakeward/core';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { CommandBlock } from '@/components/product/command-block';
import { SOURCE_CODE_URL } from '@/config';
import { t } from '@/i18n';
import { SUGGESTED_RESCUE_LAMPORTS } from '@/pages/rescue/wizard';
import { procedure, TONE_TEXT, type ProcedureId } from './procedures.ts';

const LINK = 'rounded-sm font-semibold text-primary underline underline-offset-4 hover:decoration-2';

/** Commands on a phone: one step smaller, so an option and its value stay on one line. */
const PHONE_COMMAND = '-ml-7 sm:ml-0 [&_pre]:text-xs sm:[&_pre]:text-sm';

function InApp({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={LINK}>
      {children}
    </Link>
  );
}

/** "In Stakeward" and "Without Stakeward": the two ways through every procedure, named the same everywhere. */
function Way({ kind }: { kind: 'app' | 'cli' }) {
  return (
    <span className="mr-1 font-bold">{kind === 'app' ? 'In Stakeward:' : 'Without Stakeward:'}</span>
  );
}

/**
 * One procedure: the thumb-index tab (code and urgency) at the left from 640 px, above the title on a phone; the
 * situation as an h3; one line on what holds while you act; numbered steps.
 */
function Procedure({ id, title, when, children }: { id: ProcedureId; title: string; when: ReactNode; children: ReactNode }) {
  const { code, urgency } = procedure(id);
  const Icon = urgency.icon;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-slot="procedure"
      className="grid scroll-mt-4 gap-3 border-t-2 border-foreground pt-4 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-6"
    >
      <div className="flex items-center gap-3 sm:flex-col sm:items-stretch sm:gap-2">
        <span aria-hidden="true" className="rounded-sm bg-primary px-2.5 py-1 text-center font-mono text-xl font-semibold text-on-primary sm:py-2 sm:text-2xl">
          {code}
        </span>
        <span className={`inline-flex items-center gap-1 text-sm font-bold ${TONE_TEXT[urgency.tone]}`}>
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          {urgency.word}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <h3 id={`${id}-title`} className="text-lg font-bold text-balance sm:text-2xl">
          <span className="sr-only">{code}: </span>
          {title}
        </h3>
        <p className="max-w-prose text-base text-pretty">{when}</p>
        <ol className="flex list-decimal flex-col gap-3 pl-6 text-base marker:font-mono marker:font-semibold marker:text-muted">
          {children}
        </ol>
      </div>
    </section>
  );
}

function Step({ children }: { children: ReactNode }) {
  return <li className="space-y-2 pl-1 text-pretty">{children}</li>;
}

/**
 * v12: the procedures, the main content of the landing page. The commands are the recovery card's own (core
 * `recoveryCommands`), with placeholders; the card for an account fills in its stake account and keys.
 */
export function Procedures({ cluster }: { cluster: Cluster }) {
  const commands = recoveryCommands({ mainKeyAddress: RECOVERY_PLACEHOLDERS.mainKeyAddress, url: cliUrl(cluster) });
  const command = (id: RecoveryCommandId) => (
    <CommandBlock argv={commands[id]} label={t(`recovery.commands.${id}`)} className={PHONE_COMMAND} />
  );
  const example = rfc3339Utc(lockupEndForPeriod(new Date(), 6)) ?? '';

  return (
    <section id="procedures" aria-labelledby="procedures-title" className="flex scroll-mt-4 flex-col gap-8 sm:gap-10">
      <div className="flex max-w-prose flex-col gap-2">
        <h2 id="procedures-title" className="text-2xl text-balance sm:text-3xl">
          Procedures
        </h2>
        <p className="text-base text-pretty text-muted">
          Each procedure starts in Stakeward and ends with Solana commands that need only your keys. Words in angle brackets,
          like {RECOVERY_PLACEHOLDERS.mainKey}, are yours to fill in: see <a href="#before-cli" className={LINK}>Before you run a command</a>.
        </p>
      </div>

      <Procedure
        id="p1"
        title={t('recovery.cases.stolen.title')}
        when="Without the second key the thief cannot withdraw or take the stake until the lock ends. Finish a day before that."
      >
        <Step>
          On a computer you trust, make a new wallet from a new seed phrase and send it about{' '}
          <span className="whitespace-nowrap tabular-nums">{formatSol(SUGGESTED_RESCUE_LAMPORTS)}</span>. Never send SOL to
          the stolen key.
        </Step>
        <Step>
          <Way kind="app" />
          open <InApp href="/rescue">Rescue</InApp>. Main key, second key and new wallet sign together; the new wallet pays.
        </Step>
        <Step>
          <p>
            <Way kind="cli" />
            {t('recovery.cases.stolen.find').replace(/^Or, without Stakeward, l/, 'l')}
          </p>
          {command('find')}
          <p>{t('recovery.cases.stolen.cli')}</p>
          {command('rescue')}
        </Step>
        <Step>
          List them again: the thief may have split off another account. Repeat until the list is empty. From then on the
          new wallet is your main key.
        </Step>
      </Procedure>

      <Procedure
        id="p2"
        title="The lock ends soon"
        when="Extend it with the second key before the end date. After that date, anyone with your main key can withdraw."
      >
        <Step>
          <Way kind="app" />
          on <InApp href="/app">your accounts page</InApp>, press Extend and sign with the second key. It pays the fee.
        </Step>
        <Step>
          <p>
            <Way kind="cli" />
            run this with a new end date:
          </p>
          {command('extend')}
          <p className="text-sm text-muted">
            Write {RECOVERY_PLACEHOLDERS.newEndDate} as a UTC date and time, like <span className="font-mono">{example}</span>.
            A past date removes the lock.
          </p>
        </Step>
      </Procedure>

      <Procedure id="p3" title={t('recovery.cases.lostSecond.title')} when={t('recovery.cases.lostSecond.body')}>
        <Step>Wait for the end date. Your accounts page and the recovery card both show it.</Step>
        <Step>
          <p>
            <Way kind="cli" />
            after the date, stop staking. It becomes inactive at the end of the epoch, within about 2 days:
          </p>
          {command('deactivate')}
        </Step>
        <Step>
          <p>When it is inactive, withdraw everything with the main key alone:</p>
          {command('withdraw-alone')}
        </Step>
        <Step>Lock your next stake with a new second key from a new seed phrase.</Step>
      </Procedure>

      <Procedure
        id="p4"
        title="The lock has ended"
        when="The stake is unprotected again: your main key alone can withdraw it. Your accounts page marks it in red until you lock it again."
      >
        <Step>
          <Way kind="app" />
          <InApp href="/protect">protect it again</InApp>, with the same second key or a new one. Both keys sign.
        </Step>
        <Step>
          There is no command for this step: Solana CLI {RECOVERY_CLI_VERSION} refuses to set a new lock after the old one
          ended.
        </Step>
      </Procedure>

      <Procedure id="p5" title={t('recovery.cases.stolenSecond.title')} when={t('recovery.cases.stolenSecond.body')}>
        <Step>Make a new second key from a new seed phrase, on a device the thief has never touched.</Step>
        <Step>
          <Way kind="app" />
          use Change second key on your accounts page. The old and the new second key sign.
        </Step>
        <Step>
          <p>
            <Way kind="cli" />
            hand the lock to the new key. Both second keys sign; the new one pays:
          </p>
          {command('change-second-key')}
        </Step>
        <Step>{t('recovery.cases.stolenSecond.late')}</Step>
      </Procedure>

      <Procedure
        id="p6"
        title={t('recovery.cases.withdraw.title')}
        when={`${t('components.risk.withdrawCompromised').replace('Use Rescue.', 'Use P1 instead.')}`}
      >
        <Step>
          <Way kind="app" />
          on <InApp href="/app">your accounts page</InApp>, press Withdraw. Main key and second key sign.
        </Step>
        <Step>
          <p>
            <Way kind="cli" />
            if the stake is active, stop staking first. It becomes inactive at the end of the epoch, within about 2 days:
          </p>
          {command('deactivate')}
        </Step>
        <Step>
          <p>{t('recovery.cases.withdraw.withdraw')}</p>
          {command('withdraw')}
        </Step>
      </Procedure>

      <Procedure id="p7" title={t('recovery.cases.down.title')} when={t('recovery.cases.down.body')}>
        <Step>
          <p>See a stake account's keys and lock:</p>
          {command('show')}
        </Step>
        <Step>
          Every command on this page works without Stakeward. The code is public:{' '}
          <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer" aria-label={`Source code ${t('common.opensInNewTab')}`} className={LINK}>
            Source code
          </a>
          .
        </Step>
        <Step>{t('recovery.cases.down.browserOnly')}</Step>
      </Procedure>
    </section>
  );
}
