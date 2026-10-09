import { Badge, RadioCardGroup } from '@stakeward/design-system';

const noop = () => undefined;

/**
 * The one place the site uses a separator: it sets the choice that removes protection apart from the new end dates.
 * /extend for a lock that ends on 28 October 2026: four later periods in two columns, the separator across both.
 */
export const BeforeDangerOption = () => (
  <RadioCardGroup
    legend="New end of the lock"
    legendHidden
    columns={2}
    value="6-months"
    onValueChange={noop}
    options={[
      { value: '1-month', title: '1 month', meta: 'until 10 November 2026' },
      { value: '3-months', title: '3 months', meta: 'until 10 January 2027' },
      { value: '6-months', title: '6 months', meta: 'until 10 April 2027', badge: <Badge tone="success">Recommended</Badge> },
      { value: '12-months', title: '12 months', meta: 'until 10 October 2027' },
      { value: 'remove', title: 'Remove the lock now', tone: 'danger' },
    ]}
  />
);

/** One column: a lock that already ends on 12 April 2027 leaves only 12 months as a later end. */
export const OneColumn = () => (
  <RadioCardGroup
    legend="New end of the lock"
    legendHidden
    value="12-months"
    onValueChange={noop}
    options={[
      { value: '12-months', title: '12 months', meta: 'until 10 October 2027' },
      { value: 'remove', title: 'Remove the lock now', tone: 'danger' },
    ]}
  />
);
