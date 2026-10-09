import { Badge, RadioCardGroup } from '@stakeward/design-system';
import { useState, type ComponentProps, type ReactNode } from 'react';

// Lock ends for the fixed clock (9 October 2026): T = 00:00 UTC after the end of each period, as core's
// lockupEndForPeriod computes them. The protect and extend steps hide the legend and say it as the step's h2 instead;
// only "where does this key sign" shows its legend.
const recommended = <Badge tone="success">Recommended</Badge>;
const periods = [
  { value: '1-month', title: '1 month', meta: 'until 10 November 2026' },
  { value: '3-months', title: '3 months', meta: 'until 10 January 2027' },
  { value: '6-months', title: '6 months', meta: 'until 10 April 2027', badge: recommended },
  { value: '12-months', title: '12 months', meta: 'until 10 October 2027' },
];
// Extend offers only ends later than the lock's current one (here it ends in December 2026), then removing it.
const extendChoices = [...periods.slice(1), { value: 'remove', title: 'Remove the lock now', tone: 'danger' as const }];

/** Own state, as a page holds it. */
function Group(props: Omit<ComponentProps<typeof RadioCardGroup>, 'value' | 'onValueChange'> & { initial: string }) {
  const { initial, ...rest } = props;
  const [value, setValue] = useState(initial);
  return <RadioCardGroup {...rest} value={value} onValueChange={setValue} />;
}

/** A wizard step: its h2, then the cards with the legend kept for screen readers. */
function Step({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold text-balance">{heading}</h2>
      {children}
    </section>
  );
}

/** Protect, lock period: four periods in two columns, 6 months chosen and recommended. */
export const LockPeriod = () => (
  <Step heading="How long should the lock hold?">
    <Group legend="Lock period" legendHidden options={periods} columns={2} initial="6-months" />
  </Step>
);

/** Extend: the later ends, and removing the lock apart after a separator, in danger text. */
export const NewEndWithRemove = () => (
  <Step heading="New end of the lock">
    <Group legend="New end of the lock" legendHidden options={extendChoices} columns={2} initial="6-months" />
  </Step>
);

/** Extend opened to remove the lock (from Withdraw): removing is chosen and the heading names it first. */
export const RemoveChosen = () => (
  <Step heading="Remove the lock now, or extend it">
    <Group legend="Remove the lock now, or extend it" legendHidden options={extendChoices} columns={2} initial="remove" />
  </Step>
);

/** Protect and withdraw: where the Second key signs, each card with its hint, the legend shown. */
export const SignWhere = () => (
  <Group
    legend="Where does your Second key sign?"
    columns={2}
    initial="here"
    options={[
      {
        value: 'here',
        title: 'In this browser',
        description: "Connect it here and approve here. A phone wallet's browser holds only that wallet.",
      },
      {
        value: 'link',
        title: 'On another device, by link',
        description: 'Get a link and QR code for the other device. Needs a small deposit that comes back.',
      },
    ]}
  />
);

/** Rescue, who signs the move: the Second key's two small cards; with no lock, signing by link is off with why. */
export const DisabledOption = () => (
  <Group
    legend="Where does your Second key sign?"
    legendHidden
    columns={2}
    initial="here"
    className="[&_[data-slot=radio-card]]:gap-2 [&_[data-slot=radio-card]]:p-2.5 sm:[&_[data-slot=radio-card]]:gap-3 sm:[&_[data-slot=radio-card]]:p-3 [&_[role=radiogroup]]:grid-cols-2 [&_[role=radiogroup]]:gap-2 sm:[&_[role=radiogroup]]:gap-3"
    options={[
      { value: 'here', title: 'This browser' },
      { value: 'link', title: 'By link', disabledReason: 'Without a lock, connect that wallet in this browser.' },
    ]}
  />
);
