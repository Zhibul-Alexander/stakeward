import { AccountList, AccountListItem, AccountRow, Button, Section } from '@stakeward/design-system';
import {
  ArrowDownToLineIcon,
  CalendarPlusIcon,
  ExternalLinkIcon,
  FileTextIcon,
  SendIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) so the dates in the cards never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const all = sampleRows(clock);
const pick = (...keys: SampleRow['key'][]) => keys.map((key) => all.find((row) => row.key === key)).filter((row) => row !== undefined);
const rescueHref = '/rescue?address=B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';

const extend = (
  <Button size="sm" variant="outline">
    <CalendarPlusIcon aria-hidden="true" />
    Extend
  </Button>
);
const withdrawAndCard = (
  <>
    <Button size="sm" variant="outline">
      <ArrowDownToLineIcon aria-hidden="true" />
      Withdraw
    </Button>
    <Button size="sm" variant="outline">
      <FileTextIcon aria-hidden="true" />
      Recovery card
    </Button>
  </>
);

/** The row actions /app gives: Protect behind More (the group's button covers it), Extend outside More only when the lock ends soon. */
function actionsOf(row: SampleRow): { action?: ReactNode; more?: ReactNode } {
  if (row.protection === 'unprotected') {
    return {
      more: (
        <Button size="sm" variant="outline">
          <ShieldCheckIcon aria-hidden="true" />
          Protect
        </Button>
      ),
    };
  }
  if (row.protection === 'expiring') return { action: extend, more: withdrawAndCard };
  return {
    more: (
      <>
        {extend}
        {withdrawAndCard}
      </>
    ),
  };
}

function Rows({ label, rows }: { label: string; rows: SampleRow[] }) {
  return (
    <AccountList label={label} actionColumns>
      {rows.map((row) => {
        const { action, more } = actionsOf(row);
        return (
          <AccountListItem key={row.key}>
            <AccountRow
              account={row.account}
              activation={row.activation}
              clock={row.clock}
              protection={row.protection}
              managedByService={row.managedByService}
              secondKeyKnown={row.secondKeyKnown}
              wasProtected={row.wasProtected}
              rescueHref={rescueHref}
              action={action}
              moreActions={more}
              hint={false}
              serviceDetail
            />
          </AccountListItem>
        );
      })}
    </AccountList>
  );
}

/**
 * /app's Needs attention: the title with its count, one description for every row, and "Protect N accounts" (the
 * accounts without a lock) as the screen's one filled button. Most urgent first: the lock that ends soon, then the open one.
 */
export const WithCountAndAction = () => (
  <Section
    title="Needs attention"
    count="2 · 45.95 SOL"
    description="Without a lock, or once it ends, anyone with your main key can withdraw the stake."
    action={
      <Button size="sm" variant="primary">
        <ShieldCheckIcon aria-hidden="true" />
        Protect 1 account
      </Button>
    }
  >
    <Rows label="Needs attention" rows={pick('expiring', 'unprotected')} />
  </Section>
);

/** /app's Protected: no action, the group says once what the lock means; each row keeps its actions behind More. */
export const WithoutAction = () => (
  <Section
    title="Protected"
    count="1 · 1,250.5 SOL"
    description="Withdrawing or changing the owner needs your second key until the date shown."
  >
    <Rows label="Protected" rows={pick('protected')} />
  </Section>
);

/** An h3 inside a wizard step (/protect step 1): the accounts to choose from, with a ghost Select all as the group's action. */
export const InWizardStep = () => {
  const open = pick('unprotected', 'managed-by-service');
  const [chosen, setChosen] = useState<readonly string[]>(['unprotected']);
  const allChosen = open.every((row) => chosen.includes(row.key));
  return (
    <Section
      title="Not protected (2)"
      headingLevel={3}
      description="Anyone with your Main key can withdraw these."
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setChosen(allChosen ? [] : open.map((row) => row.key));
          }}
        >
          {allChosen ? 'Clear selection' : 'Select all (2)'}
        </Button>
      }
    >
      <AccountList label="Not protected (2)">
        {open.map((row) => (
          // The product's row: the whole row toggles, and a chosen row is tinted.
          <AccountListItem
            key={row.key}
            className={
              chosen.includes(row.key)
                ? 'cursor-pointer bg-primary-soft transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-primary-soft'
                : 'cursor-pointer transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-subtle'
            }
          >
            <AccountRow
              account={row.account}
              activation={row.activation}
              clock={row.clock}
              protection={row.protection}
              managedByService={row.managedByService}
              secondKeyKnown={row.secondKeyKnown}
              hint={false}
              serviceDetail
              select={{
                checked: chosen.includes(row.key),
                label: `Protect stake account ${row.account.address.slice(0, 3)}...${row.account.address.slice(-3)}`,
                onCheckedChange: (checked) => {
                  setChosen((now) => (checked ? [...now, row.key] : now.filter((key) => key !== row.key)));
                },
              }}
            />
          </AccountListItem>
        ))}
      </AccountList>
    </Section>
  );
};

/** One item of the rescue's Next steps: an icon tile, an optional h4, one or two lines and at most one outline action. */
function NextStep({ icon, title, tone = 'default', children }: { icon: ReactNode; title?: string; tone?: 'default' | 'warning'; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={
          tone === 'warning'
            ? 'flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning'
            : 'flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary'
        }
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        {title === undefined ? null : <h4 className="text-base font-semibold">{title}</h4>}
        {children}
      </div>
    </li>
  );
}

/** An h3 with neither count nor description: the rescue result's Next steps, a checklist with one outline action per item. */
export const NestedHeading = () => (
  <Section title="Next steps" headingLevel={3}>
    <ol className="flex flex-col gap-5">
      <NextStep icon={<TriangleAlertIcon aria-hidden="true" className="size-4" />} tone="warning">
        <p className="max-w-prose font-medium">From now on, use your new wallet. Stop using the old main key: anything sent to it may be taken.</p>
        <p className="max-w-prose text-sm text-muted">Each lock stays as it was, and your second key still holds it.</p>
      </NextStep>
      <NextStep icon={<FileTextIcon aria-hidden="true" className="size-4" />} title="Print a new recovery card">
        <p className="max-w-prose text-sm text-muted">
          Your old card names the old main key, so its commands no longer work. Print the new one and keep it with your second
          key. It holds no secrets.
        </p>
        <div>
          <Button variant="outline">Open the new recovery card</Button>
        </div>
      </NextStep>
      <NextStep icon={<SendIcon aria-hidden="true" className="size-4" />} title="Get alerts for your new wallet">
        <div>
          <Button variant="outline">
            Open Telegram bot
            <ExternalLinkIcon aria-hidden="true" />
          </Button>
        </div>
      </NextStep>
    </ol>
  </Section>
);
