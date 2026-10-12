import { GATE_RESULTS_URL } from '@/config';
import { ExternalLink, Section } from './Section.tsx';

/** Runs recorded in docs/gate.md: each step's expected result matched the stake program's real answer. */
const RUNS: readonly { network: string; matched: string; date: string }[] = [
  { network: 'Solana mainnet', matched: '8 of 8', date: '5 October 2026' },
  { network: 'Solana devnet', matched: '28 of 28', date: '11 October 2026' },
  { network: 'LiteSVM, stake program v5.1.0', matched: '31 of 31', date: '11 October 2026' },
];

/**
 * Why the lock matters, from two public incidents (CLAUDE.md section 1), then the record of the mechanism checks
 * (docs/gate.md). Every figure here is from those sources; nothing is live data.
 */
export function Evidence() {
  return (
    <Section id="evidence" title="The rule is the stake program's, and it was tested">
      <div className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12">
        <div className="flex flex-col gap-3 text-base text-pretty">
          <p>
            On 8 September 2025, 192,600 SOL left SwissBorg through a hidden change of the withdraw key that a hacked staking API slipped into
            its transactions. On 31 January 2026, Step Finance lost 261,854 SOL.
          </p>
          <p className="text-muted">
            While a lock holds, the stake program refuses that change and any withdrawal unless the second key signs
            too. Stakeward runs no program of its own; it sets the lock every stake account already has.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="pb-2 text-left text-sm text-muted">Mechanism checks against the real stake program</caption>
            <thead>
              <tr className="border-b border-foreground/70">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Where
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Steps as expected
                </th>
                <th scope="col" className="hidden py-2 font-semibold sm:table-cell">
                  Run
                </th>
              </tr>
            </thead>
            <tbody>
              {RUNS.map((run) => (
                <tr key={run.network} className="border-b border-border">
                  <th scope="row" className="py-2.5 pr-3 font-normal">
                    {run.network}
                    <span className="block text-xs text-muted sm:hidden">{run.date}</span>
                  </th>
                  <td className="py-2.5 pr-3 font-serif text-lg font-medium tabular-nums">{run.matched}</td>
                  <td className="hidden py-2.5 text-muted sm:table-cell">{run.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm">
            <ExternalLink href={GATE_RESULTS_URL} label="Every step with its transaction signature" />
          </p>
        </div>
      </div>
    </Section>
  );
}
