import { AddressText, Badge, Card, CardContent, CardHeader, CardTitle } from '@stakeward/design-system';
import { CircleCheckIcon, CircleDashedIcon, CoinsIcon, ShieldCheckIcon } from 'lucide-react';

const MAIN_KEY = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';
const SECOND_KEY = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi';

/** Body with the card's side padding: what a protect transaction cannot do, as the signing summary lists it. */
export const Text = () => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle asChild>
        <h3>What this transaction cannot do</h3>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <ul className="flex flex-col gap-2 rounded-md bg-subtle p-3 text-sm">
        <li className="flex items-start gap-2">
          <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          <span>This transaction cannot move your SOL.</span>
        </li>
        <li className="flex items-start gap-2">
          <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          <span>It cannot change who can withdraw. Only the lock and its second key change.</span>
        </li>
        <li className="flex items-start gap-2 font-medium">
          <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          <span>Stakeward never asks for your seed phrase.</span>
        </li>
      </ul>
    </CardContent>
  </Card>
);

/** Rows divided by a hairline: who signs a co-signed link, each address in full (a signing screen never shortens one). */
export const Details = () => (
  <Card className="w-full max-w-xl">
    <CardHeader>
      <CardTitle asChild>
        <h3>Who signs</h3>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <ul className="flex flex-col divide-y divide-border">
        <li className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Main key</span>
            <Badge tone="success">
              <CircleCheckIcon aria-hidden="true" />
              Signed
            </Badge>
            <Badge tone="outline">
              <CoinsIcon aria-hidden="true" />
              Pays the network fee
            </Badge>
          </div>
          <AddressText address={MAIN_KEY} variant="full" />
        </li>
        <li className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Second key</span>
            <Badge tone="outline">
              <CircleDashedIcon aria-hidden="true" />
              Not signed yet
            </Badge>
          </div>
          <AddressText address={SECOND_KEY} variant="full" />
        </li>
      </ul>
    </CardContent>
  </Card>
);
