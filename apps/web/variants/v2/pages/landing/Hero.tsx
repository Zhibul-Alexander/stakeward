import type { Cluster } from '@stakeward/core';
import { FlaskConicalIcon, GlobeIcon, PlayIcon, ShieldCheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/** One line of the sample session: a prompt, an output line, a comment or an error. */
function Line({ kind = 'out', children }: { kind?: 'cmd' | 'out' | 'note' | 'err' | 'ok'; children: ReactNode }) {
  if (kind === 'cmd') {
    return (
      <span className="block text-foreground">
        <span className="text-primary phosphor">$ </span>
        {children}
      </span>
    );
  }
  const tone = { out: 'text-muted', note: 'text-muted italic', err: 'text-danger', ok: 'text-success' }[kind];
  return <span className={`block ${tone}`}>{children}</span>;
}

/**
 * A sample terminal session in plain markup: the lock as `solana stake-account` prints it, then a withdraw signed by
 * the main key alone, refused by the stake program with LockupInForce. Decorative for screen readers: the figure's
 * label says the same in one sentence.
 */
function TerminalDemo() {
  return (
    <figure
      aria-label="Example: a withdraw signed by the main key alone is refused by the network with LockupInForce."
      className="flex min-w-0 flex-col border border-border-strong bg-surface shadow-[6px_6px_0_0_var(--color-border)]"
    >
      <div aria-hidden="true" className="flex items-center justify-between gap-3 border-b border-border-strong bg-subtle px-3 py-1.5 text-xs text-muted">
        <span>operator@validator: ~</span>
        <span className="tabular-nums">tty1</span>
      </div>
      <pre aria-hidden="true" className="overflow-hidden px-3 py-3 text-xs leading-5 whitespace-pre-wrap sm:px-4 sm:py-4 sm:text-sm sm:leading-6">
        <Line kind="cmd">solana stake-account 7xKX...gAsU</Line>
        <Line>Balance: 1250.5 SOL</Line>
        <Line>Withdraw Authority: B1ag...uXu8</Line>
        <Line>Lockup Timestamp: 2027-04-10T00:00:00Z</Line>
        <Line>
          Lockup Custodian: 9DpL...96fi <span className="text-primary">&lt;- second key</span>
        </Line>
        <span className="block h-3" />
        <Line kind="note"># a thief has the main key</Line>
        <Line kind="cmd">solana withdraw-stake 7xKX...gAsU thief ALL</Line>
        <Line kind="err">Error: custom program error: 0x1</Line>
        <Line kind="err">LockupInForce</Line>
        <span className="block h-3" />
        <Line kind="ok">[ LOCKED ] 0 SOL moved</Line>
        <span className="block text-foreground">
          <span className="text-primary phosphor">$ </span>
          <span className="term-cursor" />
        </span>
      </pre>
    </figure>
  );
}

/**
 * The top of the landing page: network, the one-sentence answer, the two ways in, and a sample session showing the
 * lock refusing a withdraw. "Check my stake" stays the page's one primary button (UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="grid gap-8 pt-2 lg:grid-cols-12 lg:items-center lg:gap-10">
      <div className="flex min-w-0 flex-col gap-5 lg:col-span-6">
        <p data-slot="network" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:text-sm">
          <Badge tone="outline">
            <GlobeIcon aria-hidden="true" />
            {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
          </Badge>
          <span className={devnet ? 'md:hidden' : undefined}>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
        </p>
        <h1 id="landing-title" className="text-3xl text-balance sm:text-[2.75rem] sm:leading-[1.08] sm:font-bold sm:tracking-tighter">
          {t('landing.title')}
        </h1>
        <p className="max-w-prose border-l-2 border-primary pl-4 text-base text-pretty text-muted">{t('landing.lead')}</p>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3 *:flex-1 *:px-3 sm:*:flex-none sm:*:px-6">
            <Button asChild size="lg">
              <Link href="/app">{t('landing.checkStake')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/protect">{t('landing.protectStake')}</Link>
            </Button>
          </div>
          <p className="text-sm text-muted">
            <span aria-hidden="true" className="text-primary">// </span>
            {t('landing.checkStakeHint')}
          </p>
          <div className="flex flex-col gap-1">
            <Button asChild variant="link" className="w-fit">
              <Link href="/demo">
                <PlayIcon aria-hidden="true" />
                {t('landing.demoLink')}
              </Link>
            </Button>
            {devnet ? (
              <Button asChild variant="link" className="w-fit text-left whitespace-normal">
                <a href={MAINNET_SITE_URL}>
                  <GlobeIcon aria-hidden="true" />
                  {t('landing.tryMainnet')}
                </a>
              </Button>
            ) : (
              <Button asChild variant="link" className="w-fit text-left whitespace-normal">
                <a href={TESTNET_SITE_URL}>
                  <FlaskConicalIcon aria-hidden="true" />
                  {t('landing.tryTestnet')}
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="min-w-0 lg:col-span-6">
        <TerminalDemo />
      </div>
      <ul className="grid gap-y-1 border-y border-dashed border-border-strong py-3 text-sm sm:grid-cols-3 sm:gap-x-6 lg:col-span-12">
        {TRUST.map((key) => (
          <li key={key} className="flex items-start gap-2">
            <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
