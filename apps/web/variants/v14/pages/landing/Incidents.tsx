import { ExternalLinkIcon } from 'lucide-react';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

type Incident = {
  id: string;
  name: string;
  date: string;
  amount: string;
  what: string;
  source: { label: string; href: string };
  /** What the test record says about it: a check that covers it, or why nothing is claimed. */
  verdict: { kind: 'covered' | 'not-claimed'; title: string; body: string };
};

/** Two public losses of staked SOL, worded as docs/SUBMISSION.md sources them. */
const INCIDENTS: readonly Incident[] = [
  {
    id: 'swissborg',
    name: 'SwissBorg',
    date: '8 September 2025',
    amount: '192,600 SOL',
    what:
      "An attacker who got into its staking partner's API hid a change of the stake accounts' withdraw key inside a routine unstaking transaction. SwissBorg's own signers approved it.",
    source: { label: 'Kiln post-mortem', href: 'https://www.kiln.fi/post/re-enablement-of-kiln-services-and-security-incident-information' },
    verdict: {
      kind: 'covered',
      title: 'Covered by check 4',
      body: 'With a lock held by a separate second key, that hidden change is refused with CustodianMissing unless the second key signs too. Tested on mainnet, and on devnet with three other forms of the same instruction (checks 15a, 15c, 15d).',
    },
  },
  {
    id: 'step',
    name: 'Step Finance',
    date: '31 January 2026',
    amount: '261,854 SOL',
    what: "Staked SOL was unstaked and taken from the treasury after attackers compromised its executives' devices.",
    source: { label: 'The Block', href: 'https://www.theblock.co/post/387919' },
    verdict: {
      kind: 'not-claimed',
      title: 'Nothing claimed',
      body: 'No official statement names the exact method, so we do not say the lock would have stopped it. And no lock helps once a thief holds both keys.',
    },
  },
];

/** The two losses that motivate the product, each with what the test record can and cannot say about it. */
export function Incidents() {
  return (
    <section id="incidents" aria-labelledby="incidents-title" className="flex scroll-mt-4 flex-col gap-6">
      <div className="flex max-w-prose flex-col gap-2">
        <h2 id="incidents-title" className="text-2xl text-balance sm:text-3xl">
          Two losses of staked SOL, and what the record says about them
        </h2>
        <p className="text-base text-pretty text-muted">Facts as the linked reports give them. The second one is here because it shows where the lock stops helping.</p>
      </div>
      <ol className="grid gap-y-4 md:grid-cols-2 md:gap-x-8">
        {INCIDENTS.map((incident) => (
          <li key={incident.id} aria-labelledby={`incident-${incident.id}`} className="grid gap-4 border-t-2 border-foreground pt-4 not-first:mt-6 md:row-span-4 md:grid-rows-subgrid md:gap-4 md:not-first:mt-0">
            <div className="flex flex-col gap-1">
              <h3 id={`incident-${incident.id}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-lg font-semibold">{incident.name}</span>
                <span className="font-serif text-2xl tabular-nums">{incident.amount}</span>
              </h3>
              <p className="text-sm text-muted">{incident.date}</p>
            </div>
            <p className="text-base text-pretty">{incident.what}</p>
            <p className="text-sm">
              <a
                href={incident.source.href}
                target="_blank"
                rel="noreferrer"
                aria-label={`Source: ${incident.source.label} ${t('common.opensInNewTab')}`}
                className={LINK_CLASS}
              >
                {`Source: ${incident.source.label}`}
                <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-3.5 align-text-bottom" />
              </a>
            </p>
            <div
              data-verdict={incident.verdict.kind}
              className="flex flex-col gap-1 self-start rounded-md border border-border bg-surface p-4"
            >
              <p className="text-sm font-semibold">{incident.verdict.title}</p>
              <p className="text-sm text-pretty">{incident.verdict.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
