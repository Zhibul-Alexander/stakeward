import { cn } from 'cn';
import { BanIcon, CheckIcon, ChevronRightIcon, CircleCheckIcon, ExternalLinkIcon } from 'lucide-react';
import { explorerUrl, GATE_RESULTS_URL } from '@/config';
import { t } from '@/i18n';
import { CHECKS, GROUPS, MAINNET_RUN_FEES, PROGRAM, RUNS, SIGNATURES, type Check, type Claim, type ClaimGroup, type Network } from './evidence.ts';

const LINK_CLASS = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

/** `AntzPa…jLVw`: enough of a signature to compare with the explorer page it opens. */
export function shortSignature(signature: string): string {
  return `${signature.slice(0, 4)}…${signature.slice(-4)}`;
}

/** One network's result for one check: a tick (matched the expectation) and, on devnet and mainnet, the transaction. */
function NetworkResult({ check, network }: { check: Check; network: Network }) {
  const label = RUNS[network].label;
  if (!check.on.includes(network)) {
    return <li className="text-muted">{`${label}: not run`}</li>;
  }
  const signature = network === 'litesvm' ? undefined : SIGNATURES[check.id]?.[network];
  return (
    <li className="inline-flex items-center gap-1">
      <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-success" />
      {signature === undefined ? (
        <span>{label}</span>
      ) : (
        <a
          href={explorerUrl('tx', signature, network === 'mainnet' ? 'mainnet' : 'devnet')}
          target="_blank"
          rel="noreferrer"
          aria-label={`${label} transaction ${shortSignature(signature)} ${t('common.opensInNewTab')}`}
          className="inline-flex min-h-11 items-center gap-1 rounded-sm underline decoration-border-strong sm:min-h-0 underline-offset-4 hover:text-primary hover:decoration-primary"
        >
          {label}
          <span className="font-mono text-xs">{shortSignature(signature)}</span>
          <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
        </a>
      )}
    </li>
  );
}

/** What the stake program answered: refused with its error name, or went through. */
export function Outcome({ check }: { check: Check }) {
  return check.outcome === 'rejected' ? (
    <p className="inline-flex flex-wrap items-center gap-x-1.5 text-sm">
      <BanIcon aria-hidden="true" className="size-4 shrink-0" />
      <span>Refused with</span>
      <code className="font-mono text-sm font-medium">{check.error}</code>
    </p>
  ) : (
    <p className="inline-flex items-center gap-1.5 text-sm">
      <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0" />
      <span>Went through</span>
    </p>
  );
}

/** One check: its number in docs/gate.md, what was tried, what the program answered, where it ran. */
function CheckLine({ id }: { id: string }) {
  const check = CHECKS[id];
  if (check === undefined) return null;
  return (
    <li data-check={check.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <p className="text-sm text-pretty">
        <span className="mr-2 font-semibold tabular-nums">{`Check ${check.id}`}</span>
        {check.tried}
      </p>
      <Outcome check={check} />
      <ul aria-label={`Check ${check.id}: where it ran`} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(['litesvm', 'devnet', 'mainnet'] as const).map((network) => (
          <NetworkResult key={network} check={check} network={network} />
        ))}
      </ul>
    </li>
  );
}

function ClaimRecord({ claim }: { claim: Claim }) {
  const [first, ...rest] = claim.checks;
  return (
    <li data-claim={claim.id} className="grid gap-x-10 gap-y-3 border-t border-border py-5 sm:py-6 lg:grid-cols-record">
      <div className="flex flex-col gap-1.5">
        <p className="font-serif text-lg text-balance sm:text-2xl sm:font-medium">{claim.claim}</p>
        {claim.note === undefined ? null : <p className="max-w-prose text-sm text-pretty text-muted">{claim.note}</p>}
      </div>
      <div className="flex flex-col gap-3">
        <ul aria-label={`Checks behind: ${claim.claim}`} className="flex flex-col">
          {first === undefined ? null : <CheckLine id={first} />}
        </ul>
        {rest.length === 0 ? null : (
          // The first check carries the claim; the others are one click away, so the record stays readable end to end.
          <details className="group">
            <summary className="summary-plain inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-sm text-sm font-medium text-primary hover:text-primary-hover sm:min-h-0">
              <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-90" />
              {`${String(rest.length)} more ${rest.length === 1 ? 'check' : 'checks'}: ${rest.join(', ')}`}
            </summary>
            <ul aria-label={`More checks behind: ${claim.claim}`} className="mt-3 flex flex-col divide-y divide-border border-t border-border pt-3">
              {rest.map((id) => (
                <CheckLine key={id} id={id} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

function Group({ group }: { group: ClaimGroup }) {
  const limits = group.id === 'record-limits';
  return (
    <section
      id={group.id}
      aria-labelledby={`${group.id}-title`}
      // The limits are the part a hopeful reader skips: on their own panel, so they cannot be read as more of the same.
      className={cn('flex scroll-mt-4 flex-col', limits && '-mx-4 rounded-lg bg-subtle px-4 pt-5 pb-1 sm:mx-0 sm:px-6 sm:pt-6')}
    >
      <div className="flex max-w-prose flex-col gap-1 pb-4">
        <h3 id={`${group.id}-title`} className="text-lg font-semibold text-balance">
          {group.title}
        </h3>
        <p className="text-sm text-pretty text-muted">{group.intro}</p>
      </div>
      <ul className="flex flex-col">
        {group.claims.map((claim) => (
          <ClaimRecord key={claim.id} claim={claim} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The record: every claim of the product next to the checks of docs/gate.md that tested it, on LiteSVM, devnet and
 * mainnet, with the transactions on the explorer. The limits are tested and shown the same way.
 */
export function Record() {
  return (
    <section id="record" aria-labelledby="record-title" className="flex scroll-mt-4 flex-col gap-6 sm:gap-8">
      <div className="flex flex-col gap-4">
        <h2 id="record-title" className="text-2xl text-balance sm:text-3xl">
          Every claim, and the transaction that tested it
        </h2>
        <div className="flex max-w-prose flex-col gap-3 text-base text-pretty">
          <p>
            A script sends each attempt to Solana&apos;s stake program and compares the answer with what was expected. A tick
            means the network did exactly that. Devnet and mainnet results link to the transaction itself, failed ones
            included. Check numbers are the ones in the test record, and the ones left out are setup steps and repeats.
          </p>
        </div>
        <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
          {(['litesvm', 'devnet', 'mainnet'] as const).map((network) => {
            const run = RUNS[network];
            return (
              <div key={network} className="flex flex-col gap-0.5 bg-surface px-4 py-3">
                <dt className="text-sm font-semibold">{run.label}</dt>
                <dd className="text-sm tabular-nums">{`${String(run.matched)} of ${String(run.total)} steps as expected`}</dd>
                <dd className="text-sm text-muted">{run.date}</dd>
              </div>
            );
          })}
        </dl>
        <p className="max-w-prose text-sm text-pretty text-muted">
          {`All three runs used the same stake program binary, release ${PROGRAM.release} (sha256 `}
          <code className="font-mono text-xs break-all">{PROGRAM.sha256}</code>
          {`). The mainnet run used a throwaway key and real SOL; its 8 transactions paid ${MAINNET_RUN_FEES} in network fees.`}
        </p>
      </div>
      {GROUPS.map((group) => (
        <Group key={group.id} group={group} />
      ))}
      <p className="text-sm">
        <a href={GATE_RESULTS_URL} target="_blank" rel="noreferrer" className={LINK_CLASS} aria-label={`Read the full test record on GitHub ${t('common.opensInNewTab')}`}>
          Read the full test record on GitHub
          <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-4 align-text-bottom" />
        </a>
      </p>
    </section>
  );
}
