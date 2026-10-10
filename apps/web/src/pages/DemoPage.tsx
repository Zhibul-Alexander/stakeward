import { address, type Address } from '@solana/kit';
import { formatAlert, formatUtcDate, lockupEndForPeriod, shortAddress } from '@stakeward/core';
import { cn } from 'cn';
import { BellRingIcon, LifeBuoyIcon, RotateCcwIcon, ShieldCheckIcon, SkullIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { Section } from '@/components/layout/Section';
import { StatusBadge } from '@/components/product/status-badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t, type MessageKey } from '@/i18n';

/**
 * /demo: an interactive story for the pitch. Part 1, without Stakeward: a thief with a copy of the main key takes the
 * stake with one signature. Part 2, with Stakeward: the same thief is rejected by the stake program, can only unstake,
 * the alert goes out, and a rescue moves the stake to the New wallet.
 *
 * Everything here is simulated in the browser: no wallet, no chain read, no API call. The addresses are made up.
 * What the network accepts and rejects follows the stake program's rules (CLAUDE.md section 4, docs/gate.md), and the
 * alert is core `formatAlert`, the text the bot sends.
 */

type Role = 'main' | 'second' | 'new' | 'thief';
type Actor = Role | 'network' | 'monitor';
type Phase = 'intro' | 'stolen' | 'setup' | 'protected' | 'alerted' | 'rescued';
type Tone = 'neutral' | 'success' | 'warning' | 'danger';
type Line = { key: MessageKey; actor: Actor; tone: Tone };

const ADDRESSES: Record<Role | 'stake', Address> = {
  main: address('9kQVyBykcHmT1pVQcS4Hp7TagXunzPnTWBSotvNtmCZw'),
  second: address('9DVhQPNKok5Uptr8o1MxGgMPAGox25UMJjxnXqkCS9iu'),
  new: address('Tb6h3ZhiVdgFdwYKuabnHjhPEz6i4S73wQkRrkGU5zp'),
  thief: address('CgwfWLCuDiMLnngthNnt4Ru3VgtrQiLgHUVkz7u18L79'),
  stake: address('99BCuTUunyy9qfVrcuKgcH6BdjvYNSbYYCMZ7FA3kySP'),
};

const STAKE_SOL = '100 SOL';

/** What each button plays, line by line, and where it ends. */
const SCRIPTS: Record<'steal' | 'protect' | 'attack' | 'rescue', { lines: readonly Line[]; next: Phase }> = {
  steal: {
    lines: [
      { key: 'demo.lines.stealSign', actor: 'thief', tone: 'neutral' },
      { key: 'demo.lines.stealAccepted', actor: 'network', tone: 'danger' },
      { key: 'demo.lines.stealWithdraw', actor: 'thief', tone: 'danger' },
    ],
    next: 'stolen',
  },
  protect: {
    lines: [
      { key: 'demo.lines.protectMain', actor: 'main', tone: 'neutral' },
      { key: 'demo.lines.protectSecond', actor: 'second', tone: 'neutral' },
      { key: 'demo.lines.protectAccepted', actor: 'network', tone: 'success' },
    ],
    next: 'protected',
  },
  attack: {
    lines: [
      { key: 'demo.lines.attackAuthorize', actor: 'thief', tone: 'neutral' },
      { key: 'demo.lines.attackAuthorizeRejected', actor: 'network', tone: 'success' },
      { key: 'demo.lines.attackWithdraw', actor: 'thief', tone: 'neutral' },
      { key: 'demo.lines.attackWithdrawRejected', actor: 'network', tone: 'success' },
      { key: 'demo.lines.attackDeactivate', actor: 'thief', tone: 'neutral' },
      { key: 'demo.lines.attackDeactivateAccepted', actor: 'network', tone: 'warning' },
      { key: 'demo.lines.monitorAlert', actor: 'monitor', tone: 'neutral' },
    ],
    next: 'alerted',
  },
  rescue: {
    lines: [
      { key: 'demo.lines.rescueNew', actor: 'new', tone: 'neutral' },
      { key: 'demo.lines.rescueMain', actor: 'main', tone: 'neutral' },
      { key: 'demo.lines.rescueSecond', actor: 'second', tone: 'neutral' },
      { key: 'demo.lines.rescueAccepted', actor: 'network', tone: 'success' },
    ],
    next: 'rescued',
  },
};

const LINE_TONE: Record<Tone, string> = {
  neutral: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

const SECOND_PART: ReadonlySet<Phase> = new Set(['setup', 'protected', 'alerted', 'rescued']);

function owner(phase: Phase): Role {
  if (phase === 'stolen') return 'thief';
  if (phase === 'rescued') return 'new';
  return 'main';
}

function WalletCard({ role, phase, signing }: { role: Role; phase: Phase; signing: boolean }) {
  const holds = owner(phase) === role;
  const thief = role === 'thief';
  const mainStolen = role === 'main' && phase === 'rescued';
  const note: MessageKey = mainStolen
    ? 'demo.wallets.mainStolenNote'
    : role === 'new' && holds
      ? 'demo.wallets.newRescuedNote'
      : `demo.wallets.${role}Note`;
  return (
    <Card
      data-slot="demo-wallet"
      data-role={role}
      data-holds={holds}
      className={cn(
        'gap-2 py-3 transition-colors sm:py-4',
        thief ? 'border-danger-border' : undefined,
        holds ? (thief ? 'bg-danger-soft' : 'bg-success-soft') : undefined,
        signing ? 'outline-2 outline-offset-2 outline-ring' : undefined,
      )}
    >
      <CardHeader className="px-3 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle asChild className="flex items-center gap-2 text-base">
            <h3>
              {thief ? <SkullIcon aria-hidden="true" className="size-4 text-danger" /> : null}
              {t(`demo.wallets.${role}`)}
            </h3>
          </CardTitle>
          {signing ? (
            <Badge tone="info">{t('demo.wallets.signing')}</Badge>
          ) : null}
        </div>
        <p className="font-mono text-xs text-muted">{shortAddress(ADDRESSES[role])}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 px-3 text-sm sm:px-4">
        <p>
          <span className="text-muted">{t('demo.wallets.holds')}: </span>
          <span className="font-semibold">
            {holds ? `${t('demo.wallets.stake')} · ${STAKE_SOL}` : t('demo.wallets.nothing')}
          </span>
        </p>
        <p className="text-xs text-muted">{t(note)}</p>
      </CardContent>
    </Card>
  );
}

function StakePanel({ phase, lockDate }: { phase: Phase; lockDate: string }) {
  const locked = phase === 'protected' || phase === 'alerted' || phase === 'rescued';
  const unstaked = phase === 'stolen' || phase === 'alerted' || phase === 'rescued';
  const holder = owner(phase);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4">
      <div className="flex flex-col gap-1">
        <dt className="text-muted">{t('demo.stake.amount')}</dt>
        <dd className="font-semibold tabular-nums">{STAKE_SOL}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted">{t('demo.stake.owner')}</dt>
        <dd className={cn('font-semibold', holder === 'thief' ? 'text-danger' : undefined)}>{t(`demo.wallets.${holder}`)}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted">{t('demo.stake.state')}</dt>
        <dd>{t(unstaked ? 'demo.stake.unstaked' : 'demo.stake.staked')}</dd>
      </div>
      <div className="flex flex-col gap-1">
        <dt className="text-muted">{t('demo.stake.lock')}</dt>
        <dd>
          {phase === 'stolen' ? (
            <Badge tone="danger">
              <SkullIcon aria-hidden="true" />
              {t('demo.stake.stolen')}
            </Badge>
          ) : locked ? (
            <span className="flex flex-col gap-1">
              <StatusBadge status="protected" />
              <span className="text-xs text-muted">{t('status.lockedUntil', { date: lockDate })}</span>
            </span>
          ) : (
            <StatusBadge status="unprotected" />
          )}
        </dd>
      </div>
    </dl>
  );
}

function TelegramAlert({ text, label, onOpen }: { text: string; label: string; onOpen: () => void }) {
  return (
    <Card data-slot="demo-alert" className="gap-3 border-info-border motion-safe:animate-fade-in">
      <CardHeader>
        <CardTitle asChild className="flex items-center gap-2 text-base">
          <h3>
            <BellRingIcon aria-hidden="true" className="size-4 text-info" />
            {t('demo.alert.title')}
          </h3>
        </CardTitle>
        <p className="text-sm text-muted">{t('demo.alert.from')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="rounded-md bg-subtle p-3 text-sm">{text}</p>
        <Button onClick={onOpen} className="w-full sm:w-fit">
          <LifeBuoyIcon aria-hidden="true" />
          {label}
        </Button>
        <p className="text-xs text-muted">{t('demo.alert.note')}</p>
      </CardContent>
    </Card>
  );
}

export function DemoPage({ stepMs = 900, now = () => new Date() }: { stepMs?: number; now?: () => Date }) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [log, setLog] = useState<readonly Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [signer, setSigner] = useState<Actor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lockEnd] = useState(() => lockupEndForPeriod(now(), 6));
  const lockDate = formatUtcDate(lockEnd) ?? '';

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  function play(script: keyof typeof SCRIPTS) {
    const { lines, next } = SCRIPTS[script];
    setBusy(true);
    let index = 0;
    const tick = () => {
      const line = lines[index];
      if (line === undefined) {
        setSigner(null);
        setBusy(false);
        setPhase(next);
        timer.current = null;
        return;
      }
      setLog((previous) => [...previous, line]);
      setSigner(line.actor);
      index += 1;
      timer.current = setTimeout(tick, stepMs);
    };
    timer.current = setTimeout(tick, stepMs / 3);
  }

  function goTo(next: Phase) {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setBusy(false);
    setSigner(null);
    setLog([]);
    setPhase(next);
  }

  const second = SECOND_PART.has(phase);
  const roles: readonly Role[] = second ? ['main', 'second', 'new', 'thief'] : ['main', 'thief'];
  const step = `demo.steps.${phase}` as const;
  const alert = formatAlert(
    { type: 'DEACTIVATED', details: { deactivationEpoch: '0' }, stakeAccount: ADDRESSES.stake },
    { withdrawer: ADDRESSES.main, custodian: ADDRESSES.second, lockUntil: lockEnd, now: BigInt(Math.floor(now().getTime() / 1000)) },
  );

  return (
    <Page width="app">
      <PageHeader title={t('demo.title')} lead={t('demo.lead')} meta={<p>{t('demo.simulation')}</p>} />

      <Section
        title={t(`${step}.title`, { date: lockDate })}
        count={<Badge tone={second ? 'success' : 'outline'}>{t(second ? 'demo.parts.with' : 'demo.parts.without')}</Badge>}
        description={t(`${step}.body`)}
        action={
          phase === 'intro' ? undefined : (
            <Button variant="ghost" size="sm" onClick={() => { goTo('intro'); }}>
              <RotateCcwIcon aria-hidden="true" />
              {t('demo.actions.restart')}
            </Button>
          )
        }
      >
        {phase === 'setup' ? (
          <Alert tone="warning">
            <ShieldCheckIcon aria-hidden="true" />
            <AlertDescription>{t('demo.steps.setup.risk')}</AlertDescription>
          </Alert>
        ) : null}

        <StakePanel phase={phase} lockDate={lockDate} />

        <div className={cn('grid gap-3 sm:gap-4', second ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2')}>
          {roles.map((role) => (
            <WalletCard key={role} role={role} phase={phase} signing={busy && signer === role} />
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          {phase === 'intro' || phase === 'protected' ? (
            <Button variant="danger" size="lg" disabled={busy} onClick={() => { play(phase === 'intro' ? 'steal' : 'attack'); }}>
              <SkullIcon aria-hidden="true" />
              {t(busy ? 'demo.actions.working' : 'demo.actions.steal')}
            </Button>
          ) : null}
          {phase === 'stolen' ? (
            <Button size="lg" onClick={() => { goTo('setup'); }}>
              {t('demo.actions.addStakeward')}
            </Button>
          ) : null}
          {phase === 'setup' ? (
            <Button size="lg" disabled={busy} onClick={() => { play('protect'); }}>
              <ShieldCheckIcon aria-hidden="true" />
              {t(busy ? 'demo.actions.working' : 'demo.actions.protect')}
            </Button>
          ) : null}
          {phase === 'rescued' ? (
            <Button asChild size="lg">
              <Link href="/protect">{t('demo.actions.protectReal')}</Link>
            </Button>
          ) : null}
        </div>

        {phase === 'alerted' && !busy ? (
          <TelegramAlert text={alert.text} label={alert.buttonLabel} onOpen={() => { play('rescue'); }} />
        ) : null}
      </Section>

      <Section title={t('demo.log.title')}>
        {log.length === 0 ? (
          <p className="text-sm text-muted">{t('demo.log.empty')}</p>
        ) : (
          <div role="log" aria-live="polite" className="rounded-lg border border-border bg-surface p-4 text-sm">
            <ol className="flex flex-col gap-2">
            {log.map((line, index) => (
              <li key={`${line.key}-${String(index)}`} className="flex gap-3 motion-safe:animate-fade-in">
                <span className="w-20 shrink-0 text-muted">
                  {t(`demo.actors.${line.actor}`)}
                  {/* Copied text and screen readers get "Main key: Signs ..." rather than "Main keySigns ...". */}
                  <span className="sr-only">{': '}</span>
                </span>
                <span className={LINE_TONE[line.tone]}>{t(line.key, { date: lockDate })}</span>
              </li>
            ))}
            </ol>
          </div>
        )}
      </Section>
    </Page>
  );
}
