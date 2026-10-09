import { Checkbox, Input, Label, RadioGroup, RadioGroupItem } from '@stakeward/design-system';

/** Over a text field: the label and its hint share a line where they fit, as on the accounts page. */
export const FieldLabel = () => (
  <div className="flex max-w-md flex-col gap-2">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <Label htmlFor="lookup-address">Wallet address</Label>
      <p id="lookup-address-hint" className="text-sm text-muted">
        The wallet you staked from, or your second key.
      </p>
    </div>
    <Input
      id="lookup-address"
      aria-describedby="lookup-address-hint"
      placeholder="Paste an address"
      autoComplete="off"
      spellCheck={false}
      className="font-mono"
    />
  </div>
);

/** Stacked over a field: label, then hint, then the field (rescue step 1, the main key that may be stolen). */
export const StackedOverAField = () => (
  <div className="flex max-w-md flex-col gap-2">
    <Label htmlFor="rescue-main">Main key address</Label>
    <p id="rescue-main-hint" className="text-sm text-muted">
      Paste its address, or connect it. Connecting signs nothing.
    </p>
    <Input id="rescue-main" type="text" aria-describedby="rescue-main-hint" autoComplete="off" spellCheck={false} className="font-mono" />
  </div>
);

/** Beside a checkbox: clicking the words ticks the box; a hint under the label is read with the box. */
export const BesideACheckbox = () => (
  <div className="flex max-w-md items-start gap-3">
    <Checkbox id="label-seed" aria-describedby="label-seed-hint" className="mt-0.5" />
    <div className="flex flex-col gap-1">
      <Label htmlFor="label-seed">My second key comes from a different seed phrase</Label>
      <p id="label-seed-hint" className="text-sm text-muted">
        With one seed phrase, whoever steals it gets both keys and the lock stops nothing.
      </p>
    </div>
  </div>
);

/** A full address as a radio's label (rescue step 3): mono, and it wraps instead of overflowing. */
export const AddressLabel = () => (
  <fieldset className="flex max-w-sm flex-col">
    <legend id="label-keys" className="mb-3 text-sm font-medium">
      Your stake is locked by more than one second key. Which one moves stake in this run?
    </legend>
    <RadioGroup aria-labelledby="label-keys" defaultValue="9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi">
      <div className="flex items-start gap-3">
        <RadioGroupItem value="9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi" id="label-key-a" className="mt-0.5" />
        <Label htmlFor="label-key-a" className="min-w-0 font-mono break-all">
          9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi
        </Label>
      </div>
      <div className="flex items-start gap-3">
        <RadioGroupItem value="57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz" id="label-key-b" className="mt-0.5" />
        <Label htmlFor="label-key-b" className="min-w-0 font-mono break-all">
          57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz
        </Label>
      </div>
    </RadioGroup>
  </fieldset>
);
