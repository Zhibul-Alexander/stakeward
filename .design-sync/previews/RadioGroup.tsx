import { Label, RadioGroup, RadioGroupItem } from '@stakeward/design-system';

/** Rescue step 3, when more than one second key locks the stake: pick the one for this run. Full addresses wrap in mono, each radio aligned to its first line. */
export const ChooseSecondKey = () => {
  const keys = ['9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi', '57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz'];
  return (
    <fieldset className="flex max-w-sm flex-col">
      <legend id="rg-keys" className="mb-3 text-sm font-medium">
        Your stake is locked by more than one second key. Which one moves stake in this run?
      </legend>
      <RadioGroup aria-labelledby="rg-keys" defaultValue={keys[0]}>
        {keys.map((key) => (
          <div key={key} className="flex items-start gap-3">
            <RadioGroupItem value={key} id={`rg-keys-${key}`} className="mt-0.5" />
            <Label htmlFor={`rg-keys-${key}`} className="min-w-0 font-mono break-all">
              {key}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
};

/** The four lock periods on the bare primitive, six months (the default) picked. The protect wizard shows the same group as cards with each end date (RadioCardGroup). */
export const LockPeriod = () => (
  <fieldset className="flex flex-col">
    <legend id="rg-period" className="mb-3 text-sm font-medium">
      Lock period
    </legend>
    <RadioGroup aria-labelledby="rg-period" defaultValue="6">
      {(
        [
          ['1', '1 month'],
          ['3', '3 months'],
          ['6', '6 months'],
          ['12', '12 months'],
        ] as const
      ).map(([value, label]) => (
        <div key={value} className="flex items-center gap-3">
          <RadioGroupItem value={value} id={`rg-period-${value}`} />
          <Label htmlFor={`rg-period-${value}`}>{label}</Label>
        </div>
      ))}
    </RadioGroup>
  </fieldset>
);
