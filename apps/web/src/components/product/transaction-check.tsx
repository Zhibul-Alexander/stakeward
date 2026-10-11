import {
  formatSol,
  formatUtcDate,
  type ScanEffect,
  type ScanErrorCode,
  type ScannedAddress,
  type ScannedInstruction,
  type ScanReport,
  type ScanRisk,
} from '@stakeward/core';
import { cn } from 'cn';
import {
  CircleCheckIcon,
  FileSearchIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  OctagonAlertIcon,
  EyeOffIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { t, type MessageKey } from '@/i18n';
import { AddressText } from './address-text.tsx';
import { EmptyState } from './empty-state.tsx';
import { ErrorState } from './error-state.tsx';

/** Every state of the /check result (DECISIONS.md D126). */
export type TransactionCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'error'; code: Exclude<ScanErrorCode, 'empty'>; detail: string }
  | { status: 'ready'; report: ScanReport };

type RiskLook = { badge: NonNullable<BadgeProps['tone']>; alert: 'danger' | 'warning' | 'success'; icon: LucideIcon };

/** Word + colour + icon (UX rule 5). */
const RISK_LOOKS: Record<ScanRisk, RiskLook> = {
  danger: { badge: 'danger', alert: 'danger', icon: OctagonAlertIcon },
  caution: { badge: 'warning', alert: 'warning', icon: TriangleAlertIcon },
  ok: { badge: 'success', alert: 'success', icon: CircleCheckIcon },
};

const RISK_LABEL: Record<ScanRisk, MessageKey> = { danger: 'check.risk.danger', caution: 'check.risk.caution', ok: 'check.risk.ok' };

const VERDICT: Record<ScanRisk, { title: MessageKey; body: MessageKey }> = {
  danger: { title: 'check.verdict.danger.title', body: 'check.verdict.danger.body' },
  caution: { title: 'check.verdict.caution.title', body: 'check.verdict.caution.body' },
  ok: { title: 'check.verdict.ok.title', body: 'check.verdict.ok.body' },
};

/** The page's overall verdict in words: title, then body. */
export function verdictText(risk: ScanRisk): string {
  return `${t(VERDICT[risk].title)}. ${t(VERDICT[risk].body)}`;
}

export function riskLabel(risk: ScanRisk): string {
  return t(RISK_LABEL[risk]);
}

/** The program's name in words. */
export function programLabel(ix: ScannedInstruction): string {
  const { effect } = ix;
  if (effect.kind !== 'program') return t('check.program.stake');
  switch (effect.program) {
    case 'system':
      return t('check.program.system');
    case 'compute-budget':
      return t('check.program.computeBudget');
    case 'lighthouse':
      return t('check.program.lighthouse');
    case 'unknown':
      return t('check.program.unknown');
  }
}

/** The instruction's technical name, when the bytes give one (shown as code, not prose). */
export function instructionName(effect: ScanEffect): string | null {
  switch (effect.kind) {
    case 'authorize':
    case 'set-lockup':
    case 'move':
    case 'initialize':
      return effect.variant;
    case 'withdraw':
      return 'Withdraw';
    case 'merge':
      return 'Merge';
    case 'deactivate':
      return 'Deactivate';
    case 'delegate':
      return 'DelegateStake';
    case 'split':
      return 'Split';
    case 'deactivate-delinquent':
      return 'DeactivateDelinquent';
    case 'stake-info':
      return effect.name;
    case 'stake-unreadable':
      return null;
    case 'program':
      return effect.name;
  }
}

/** What the instruction does, in plain sentences. */
export function effectSentences(effect: ScanEffect): string[] {
  switch (effect.kind) {
    case 'authorize':
      return [t(effect.role === 'withdrawer' ? 'check.effect.authorizeWithdrawer' : 'check.effect.authorizeStaker')];
    case 'set-lockup': {
      const out = [t('check.effect.setLockup')];
      if (effect.unixTimestamp !== null) {
        const date = effect.unixTimestamp === 0n ? null : formatUtcDate(effect.unixTimestamp);
        out.push(date === null ? t('check.effect.lockRemoved') : t('check.effect.lockDate', { date }));
      }
      if (effect.epoch !== null && effect.epoch !== 0n) out.push(t('check.effect.lockEpoch', { epoch: effect.epoch.toString() }));
      if (effect.custodianChanges) out.push(t('check.effect.lockNewKey'));
      return out;
    }
    case 'withdraw':
      return [t('check.effect.withdraw', { amount: formatSol(effect.lamports) })];
    case 'merge':
      return [t('check.effect.merge')];
    case 'deactivate':
      return [t('check.effect.deactivate')];
    case 'delegate':
      return [t('check.effect.delegate')];
    case 'split':
      return [t('check.effect.split', { amount: formatSol(effect.lamports) })];
    case 'move':
      return [
        t(effect.variant === 'MoveStake' ? 'check.effect.moveStake' : 'check.effect.moveLamports', { amount: formatSol(effect.lamports) }),
      ];
    case 'initialize':
      return effect.lockup === null ? [t('check.effect.initialize')] : [t('check.effect.initialize'), t('check.effect.initializeLock')];
    case 'deactivate-delinquent':
      return [t('check.effect.deactivateDelinquent')];
    case 'stake-info':
      return [t('check.effect.stakeInfo')];
    case 'stake-unreadable':
      return [t('check.effect.unreadable')];
    case 'program':
      return [t(effect.program === 'unknown' ? 'check.effect.unknownProgram' : 'check.effect.other')];
  }
}

type Field = { label: MessageKey; address: ScannedAddress };

/** The addresses an instruction names, in full on screen (UX rule 9: who gets control or SOL is never shortened). */
export function effectFields(ix: ScannedInstruction): Field[] {
  const { effect } = ix;
  switch (effect.kind) {
    case 'authorize':
      return [
        { label: 'check.field.stake', address: effect.stake },
        { label: 'check.field.newAuthority', address: effect.newAuthority },
        { label: 'check.field.authority', address: effect.authority },
        ...(effect.custodian === null ? [] : [{ label: 'check.field.custodian' as const, address: effect.custodian }]),
      ];
    case 'set-lockup':
      return [
        { label: 'check.field.stake', address: effect.stake },
        ...(effect.custodianChanges ? [{ label: 'check.field.newCustodian' as const, address: effect.newCustodian }] : []),
        { label: 'check.field.authority', address: effect.authority },
      ];
    case 'withdraw':
      return [
        { label: 'check.field.stake', address: effect.stake },
        { label: 'check.field.recipient', address: effect.recipient },
        { label: 'check.field.authority', address: effect.authority },
        ...(effect.custodian === null ? [] : [{ label: 'check.field.custodian' as const, address: effect.custodian }]),
      ];
    case 'merge':
    case 'move':
      return [
        { label: 'check.field.source', address: effect.source },
        { label: 'check.field.destination', address: effect.destination },
        { label: 'check.field.authority', address: effect.authority },
      ];
    case 'deactivate':
      return [
        { label: 'check.field.stake', address: effect.stake },
        { label: 'check.field.authority', address: effect.authority },
      ];
    case 'delegate':
      return [
        { label: 'check.field.stake', address: effect.stake },
        { label: 'check.field.vote', address: effect.vote },
        { label: 'check.field.authority', address: effect.authority },
      ];
    case 'split':
      return [
        { label: 'check.field.stake', address: effect.stake },
        { label: 'check.field.newStake', address: effect.newStake },
        { label: 'check.field.authority', address: effect.authority },
      ];
    case 'initialize':
      return [
        { label: 'check.field.stake', address: effect.stake },
        { label: 'check.field.staker', address: effect.staker },
        { label: 'check.field.withdrawer', address: effect.withdrawer },
        ...(effect.lockup === null ? [] : [{ label: 'check.field.lockCustodian' as const, address: effect.lockup.custodian }]),
      ];
    case 'deactivate-delinquent':
      return [{ label: 'check.field.stake', address: effect.stake }];
    case 'program':
      return effect.program === 'unknown' ? [{ label: 'check.field.program', address: ix.programAddress }] : [];
    case 'stake-info':
    case 'stake-unreadable':
      return [];
  }
}

/**
 * Facts for "Ask your AI" (D122): one line per instruction, its risk, what it does and the addresses it names. No raw
 * transaction bytes: the descriptions are enough.
 */
export function scanPromptFacts(report: ScanReport): [string, string][] {
  const facts: [string, string][] = report.instructions.map((ix) => {
    const name = instructionName(ix.effect);
    const label = t('check.ai.instruction', {
      n: ix.index + 1,
      program: name === null ? programLabel(ix) : `${programLabel(ix)} ${name}`,
      risk: riskLabel(ix.risk),
    });
    const parts = [...effectSentences(ix.effect)];
    for (const field of effectFields(ix)) parts.push(`${t(field.label)}: ${field.address ?? t('check.field.hidden')}`);
    if (ix.usesLookupTable) parts.push(t('check.effect.hidden'));
    if (ix.wallet !== null) parts.push(t(ix.wallet === 'replaced' ? 'check.wallet.replaced' : 'check.wallet.authority'));
    return [label, parts.join(' ')];
  });
  for (const table of report.lookupTables) facts.push([t('check.ai.lookupTable'), `${table}. ${t('check.lookupTable')}`]);
  if (report.stakeward !== null) facts.push([t('check.ai.stakeward'), t('check.stakeward')]);
  return facts;
}

function RiskBadge({ risk }: { risk: ScanRisk }) {
  const { badge, icon: Icon } = RISK_LOOKS[risk];
  return (
    <Badge tone={badge} data-risk={risk}>
      <Icon aria-hidden="true" />
      {riskLabel(risk)}
    </Badge>
  );
}

function FieldValue({ address }: { address: ScannedAddress }) {
  if (address === null) {
    return (
      <span className="inline-flex items-center gap-1 text-warning">
        <EyeOffIcon aria-hidden="true" className="size-4" />
        {t('check.field.hidden')}
      </span>
    );
  }
  return <AddressText address={address} variant="full" />;
}

function InstructionItem({ ix, headingLevel }: { ix: ScannedInstruction; headingLevel: 3 | 4 }) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const name = instructionName(ix.effect);
  const fields = effectFields(ix);
  return (
    <li
      data-slot="check-instruction"
      data-risk={ix.risk}
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-surface p-4',
        ix.risk === 'danger' ? 'border-danger-border' : 'border-border',
        ix.wallet === 'replaced' && 'border-2',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge risk={ix.risk} />
        <Heading className="flex flex-wrap gap-x-2 font-semibold">
          <span>{t('check.instruction', { n: ix.index + 1 })}</span>
          <span aria-hidden="true" className="text-muted">
            ·
          </span>
          <span className="font-normal text-muted">{programLabel(ix)}</span>
        </Heading>
        {name === null ? null : <code className="rounded-sm bg-subtle px-1.5 py-0.5 font-mono text-xs">{name}</code>}
      </div>
      {ix.wallet === null ? null : (
        <p className={cn('flex items-center gap-2 font-semibold', ix.wallet === 'replaced' ? 'text-danger' : 'text-foreground')}>
          <KeyRoundIcon aria-hidden="true" className="size-4 shrink-0" />
          {t(ix.wallet === 'replaced' ? 'check.wallet.replaced' : 'check.wallet.authority')}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {effectSentences(ix.effect).map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
        {ix.usesLookupTable ? <p className="text-warning">{t('check.effect.hidden')}</p> : null}
      </div>
      {fields.length === 0 ? null : (
        <dl className="flex flex-col gap-2 text-sm">
          {fields.map((field) => (
            <div key={field.label} className="flex flex-col gap-1">
              <dt className="text-muted">{t(field.label)}</dt>
              <dd>
                <FieldValue address={field.address} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function Report({ report, headingLevel }: { report: ScanReport; headingLevel: 2 | 3 }) {
  const { alert, icon: Icon } = RISK_LOOKS[report.risk];
  const signersId = useId();
  return (
    <div data-slot="transaction-check" data-risk={report.risk} className="flex flex-col gap-4">
      <Alert tone={alert}>
        <Icon aria-hidden="true" />
        <AlertTitle>{t(VERDICT[report.risk].title)}</AlertTitle>
        <AlertDescription className="text-foreground">{t(VERDICT[report.risk].body)}</AlertDescription>
      </Alert>
      {report.stakeward === null ? null : (
        <Alert tone="info">
          <ShieldCheckIcon aria-hidden="true" />
          <AlertTitle>{t('check.stakeward')}</AlertTitle>
        </Alert>
      )}
      {report.lookupTables.length === 0 ? null : (
        <Alert tone="warning">
          <EyeOffIcon aria-hidden="true" />
          <AlertTitle>{t('check.lookupTable')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-1 text-foreground">
            {report.lookupTables.map((table) => (
              <div key={table} className="flex flex-col gap-1">
                <span className="text-muted">{t('check.lookupTableAddress')}</span>
                <AddressText address={table} variant="full" />
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}
      {report.messageOnly ? <p className="text-sm text-muted">{t('check.messageOnly')}</p> : null}
      <ol role="list" className="flex flex-col gap-3">
        {report.instructions.map((ix) => (
          <InstructionItem key={ix.index} ix={ix} headingLevel={headingLevel === 2 ? 3 : 4} />
        ))}
      </ol>
      <div className="flex flex-col gap-1 text-sm">
        <p id={signersId} className="text-muted">
          {t('check.signers')}
        </p>
        <ul aria-labelledby={signersId} role="list" className="flex flex-col gap-1">
          {report.requiredSigners.map((signer) => (
            <li key={signer}>
              <AddressText address={signer} variant="full" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const ERRORS: Record<Exclude<ScanErrorCode, 'empty'>, { title: MessageKey; body: MessageKey }> = {
  malformed: { title: 'check.errors.malformedTitle', body: 'check.errors.malformedBody' },
  address: { title: 'check.errors.addressTitle', body: 'check.errors.addressBody' },
  secret: { title: 'check.errors.secretTitle', body: 'check.errors.secretBody' },
};

type TransactionCheckProps = {
  state: TransactionCheckState;
  /** Level of the instruction headings' parent: the page's result section is an h2. */
  headingLevel?: 2 | 3 | undefined;
  className?: string | undefined;
};

/**
 * The result of /check (DECISIONS.md D126): the verdict, Stakeward's own format when the strict inspector accepts the
 * bytes, the lookup-table warning, then every instruction with its risk (word, colour, icon), what it does and the
 * addresses it names in full. Everything shown comes from the pasted bytes and is rendered as text.
 */
export function TransactionCheck({ state, headingLevel = 2, className }: TransactionCheckProps) {
  return (
    <div className={className}>
      {state.status === 'idle' ? (
        <EmptyState icon={FileSearchIcon} title={t('check.emptyTitle')} headingLevel={headingLevel === 2 ? 3 : 2}>
          <p>{t('check.emptyBody')}</p>
        </EmptyState>
      ) : state.status === 'checking' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Spinner aria-hidden="true" className="text-muted" />
          {t('check.checking')}
        </p>
      ) : state.status === 'error' ? (
        <ErrorState title={t(ERRORS[state.code].title)} message={t(ERRORS[state.code].body)} detail={state.detail} />
      ) : (
        <Report report={state.report} headingLevel={headingLevel} />
      )}
    </div>
  );
}
