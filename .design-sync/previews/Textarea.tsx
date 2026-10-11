import { Label, Textarea } from '@stakeward/design-system';

// The one product use: /check's Transaction field, six rows of mono text that breaks anywhere.

const HINT = 'Base64 or base58, as a site or a wallet\'s developer view shows it, or a Stakeward co-sign link.';
const PASTED =
  'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAMFlmUD3HEaVBV8xMbhGzK2fKPhw0kDtJkS5CuJ8vqvTnUGp9UXGSxWjuCKhF9z0peIzwNcMUWKrfS1CLd4yAAAAAAGodgXkTdUKpg0N73+KnqyVX9TXIp4citopJ3AAAAAAAah2BeRN1QqmDQ3vf4qerJVf1NcinhyK2ikncAAAAAMDAAUCQEIPAAMACQPoAwAAAAAAAAQCAQIMAgAAAABAQg8AAAAAAA==';

/** Empty, as /check opens: label, the field, and the hint under it. */
export const TransactionField = () => (
  <div className="flex max-w-2xl flex-col gap-2">
    <Label htmlFor="ta-empty">Transaction</Label>
    <Textarea
      id="ta-empty"
      rows={6}
      autoComplete="off"
      spellCheck={false}
      className="font-mono break-all"
      aria-describedby="ta-empty-hint"
    />
    <p id="ta-empty-hint" className="text-sm text-muted">
      {HINT}
    </p>
  </div>
);

/** A base64 transaction pasted from a site, before Check. */
export const Pasted = () => (
  <div className="flex max-w-2xl flex-col gap-2">
    <Label htmlFor="ta-filled">Transaction</Label>
    <Textarea
      id="ta-filled"
      rows={6}
      autoComplete="off"
      spellCheck={false}
      className="font-mono break-all"
      defaultValue={PASTED}
      aria-describedby="ta-filled-hint"
    />
    <p id="ta-filled-hint" className="text-sm text-muted">
      {HINT}
    </p>
  </div>
);

/** Check pressed with nothing pasted: red border, the error above the hint, both linked to the field. */
export const NothingPasted = () => (
  <div className="flex max-w-2xl flex-col gap-2">
    <Label htmlFor="ta-bad">Transaction</Label>
    <Textarea
      id="ta-bad"
      rows={6}
      autoComplete="off"
      spellCheck={false}
      className="font-mono break-all"
      aria-invalid="true"
      aria-describedby="ta-bad-error ta-bad-hint"
    />
    <p id="ta-bad-error" className="text-sm text-danger">
      Paste a transaction first.
    </p>
    <p id="ta-bad-hint" className="text-sm text-muted">
      {HINT}
    </p>
  </div>
);
