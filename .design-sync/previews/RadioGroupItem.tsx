import { Label, RadioCardGroup, RadioGroup, RadioGroupItem } from '@stakeward/design-system';

const keys = ['9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi', '57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz'];

/** Selected and unselected, as rescue step 3 lists the second keys when more than one locks the stake: the chosen ring turns primary with a filled dot. */
export const SelectedAndUnselected = () => (
  <fieldset className="flex flex-col">
    <legend id="rgi-keys" className="mb-3 text-sm font-medium">
      Your stake is locked by more than one second key. Which one moves stake in this run?
    </legend>
    <RadioGroup aria-labelledby="rgi-keys" defaultValue={keys[0]}>
      {keys.map((key) => (
        <div key={key} className="flex items-start gap-3">
          <RadioGroupItem value={key} id={`rgi-keys-${key}`} className="mt-0.5" />
          <Label htmlFor={`rgi-keys-${key}`} className="min-w-0 font-mono break-all">
            {key}
          </Label>
        </div>
      ))}
    </RadioGroup>
  </fieldset>
);

/** Disabled item, as rescue step 3 shows the Second key's row when no account is locked: the "By link" card's radio dims, its title stays, the reason sits under it. The legend is for screen readers. */
export const DisabledItem = () => (
  // About the width of the signers table's right column on a desktop rescue page.
  <div className="max-w-md">
    <RadioCardGroup
      legend="Where does your Second key sign?"
      legendHidden
      columns={2}
      className="[&_[data-slot=radio-card]]:gap-2 [&_[data-slot=radio-card]]:p-2.5 sm:[&_[data-slot=radio-card]]:gap-3 sm:[&_[data-slot=radio-card]]:p-3 [&_[role=radiogroup]]:grid-cols-2 [&_[role=radiogroup]]:gap-2 sm:[&_[role=radiogroup]]:gap-3"
      value="here"
      onValueChange={() => undefined}
      options={[
        { value: 'here', title: 'This browser' },
        { value: 'link', title: 'By link', disabledReason: 'Without a lock, connect that wallet in this browser.' },
      ]}
    />
  </div>
);
