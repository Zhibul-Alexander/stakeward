import { INSTALL_CLI_COMMAND, LEDGER_PUBKEY_COMMAND, RECOVERY_CLI_VERSION, RECOVERY_PLACEHOLDERS } from '@stakeward/core';
import { Link } from 'wouter';
import { CommandBlock } from '@/components/product/command-block';
import { t } from '@/i18n';

const LINK = 'rounded-sm font-semibold text-primary underline underline-offset-4 hover:decoration-2';

/** The keys a command signs with: each placeholder stands for a keypair file path or a Ledger URL. */
const KEYS = [
  [RECOVERY_PLACEHOLDERS.mainKey, t('common.roles.main')],
  [RECOVERY_PLACEHOLDERS.secondKey, t('common.roles.second')],
  [RECOVERY_PLACEHOLDERS.newWallet, t('common.roles.new')],
  [RECOVERY_PLACEHOLDERS.newSecondKey, 'A new second key'],
] as const;

/**
 * v12: what a reader needs before the commands of the procedures work, and the card that fills them in for each stake
 * account. Facts from the recovery card (core: CLI version, installer, Ledger address command).
 */
export function BeforeCli() {
  return (
    <section id="before-cli" aria-labelledby="before-cli-title" className="flex scroll-mt-4 flex-col gap-5 border-t-2 border-foreground pt-4">
      <div className="flex max-w-prose flex-col gap-2">
        <h2 id="before-cli-title" className="text-2xl text-balance">
          Before you run a command
        </h2>
        <p className="text-base text-pretty text-muted">{t('recovery.cases.noSeed')}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2 md:gap-10">
        <ol className="flex list-decimal flex-col gap-4 pl-6 text-base marker:font-mono marker:font-semibold marker:text-muted">
          <li className="space-y-2 pl-1">
            <p>Install Solana CLI {RECOVERY_CLI_VERSION} on Linux or macOS. The card's commands were run with this version.</p>
            <CommandBlock argv={INSTALL_CLI_COMMAND} label={t('recovery.commands.install')} className="-ml-7 sm:ml-0 [&_pre]:text-xs sm:[&_pre]:text-sm" />
          </li>
          <li className="space-y-2 pl-1">
            <p>Put every key that signs on this one computer: a keypair file or a Ledger. Find a Ledger's address with:</p>
            <CommandBlock argv={LEDGER_PUBKEY_COMMAND} label={t('recovery.commands.ledger')} className="-ml-7 sm:ml-0 [&_pre]:text-xs sm:[&_pre]:text-sm" />
          </li>
        </ol>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border-strong bg-surface">
            <p className="border-b border-border px-4 py-2 text-sm font-bold">Replace each placeholder with a file path or a Ledger URL</p>
            <dl className="flex flex-col divide-y divide-border text-sm">
              {KEYS.map(([placeholder, role]) => (
                <div key={placeholder} className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2">
                  <dt className="font-mono">{placeholder}</dt>
                  <dd>{role}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-subtle p-4">
            <h3 className="text-base font-bold">Print a recovery card for each stake account</h3>
            <p className="text-sm text-pretty">
              The card holds these procedures with your stake account and both key addresses filled in. Public addresses only,
              no secrets. Open it from an account on <Link href="/app" className={LINK}>your accounts page</Link>, under More.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
