import { Button, Input, Label, Skeleton } from '@stakeward/design-system';
import { CopyIcon, SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { sampleLinkUrl } from '../../apps/web/src/pages/dev-ui/samples';

/** The accounts page lookup, empty: label and hint on one line, a mono address field and Check side by side. */
export const AddressLookup = () => (
  <div className="flex max-w-2xl flex-col gap-2">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <Label htmlFor="input-lookup">Wallet address</Label>
      <p id="input-lookup-hint" className="text-sm text-muted">
        The wallet you staked from, or your second key.
      </p>
    </div>
    <div className="flex gap-2">
      <Input
        id="input-lookup"
        type="text"
        placeholder="Paste an address"
        autoComplete="off"
        spellCheck={false}
        aria-describedby="input-lookup-hint"
        className="font-mono"
      />
      <Button type="submit" variant="primary">
        <SearchIcon aria-hidden="true" />
        Check
      </Button>
    </div>
  </div>
);

/** Filled: a second key that signs on another device, pasted as a full address under its label and hint. */
export const Filled = () => (
  <div className="flex max-w-2xl flex-col gap-2">
    <Label htmlFor="input-second">Second key address</Label>
    <p id="input-second-hint" className="text-sm text-muted">
      Paste only a wallet you or someone you trust created. Stakeward never suggests a second key address.
    </p>
    <Input
      id="input-second"
      type="text"
      defaultValue="9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi"
      autoComplete="off"
      spellCheck={false}
      aria-describedby="input-second-hint"
      className="font-mono"
    />
  </div>
);

/** Invalid, after Check: the border turns red and the error under the field, linked to it, says what to check. */
export const Invalid = () => (
  <div className="flex max-w-2xl flex-col gap-2">
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <Label htmlFor="input-bad">Wallet address</Label>
      <p id="input-bad-hint" className="text-sm text-muted">
        The wallet you staked from, or your second key.
      </p>
    </div>
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          id="input-bad"
          type="text"
          defaultValue="0xabc"
          autoComplete="off"
          spellCheck={false}
          aria-invalid="true"
          aria-describedby="input-bad-hint input-bad-error"
          className="font-mono"
        />
        <Button type="submit" variant="primary">
          <SearchIcon aria-hidden="true" />
          Check
        </Button>
      </div>
      <p id="input-bad-error" role="alert" className="text-sm font-medium text-danger">
        This is not a Solana address. Check it: it should be 32 to 44 letters and digits.
      </p>
    </div>
  </div>
);

/** Read-only: the signing link to send to another device, selectable in a mono field, with Copy link under it. */
export const ReadOnlyLink = () => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void sampleLinkUrl('https://stakeward-prod.stakeward.workers.dev').then(setUrl);
  }, []);
  return (
    <div className="flex max-w-xl flex-col gap-2">
      <Label htmlFor="input-link">Signing link</Label>
      {url === null ? <Skeleton className="h-10 w-full" /> : <Input id="input-link" readOnly value={url} className="min-w-0 font-mono" />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button type="button" className="w-full sm:w-fit">
          <CopyIcon aria-hidden="true" />
          Copy link
        </Button>
      </div>
    </div>
  );
};
