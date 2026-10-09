import { AddressText, Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@stakeward/design-system';
import { CircleCheckIcon, CoinsIcon } from 'lucide-react';

const MAIN_KEY = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';

/** Title over description, with the card's side padding: the question before a signing link is cancelled, and its answer. */
export const TitleAndDescription = () => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle asChild>
        <h3>Cancel the link?</h3>
      </CardTitle>
      <CardDescription>
        Cancelling closes your link-signing account, so this link stops working. Its deposit of 0.00144768 SOL comes back
        to your Main key. If the other device already sent the transaction, that change stays.
      </CardDescription>
    </CardHeader>
    <CardFooter>
      <Button variant="outline">Yes, cancel the link</Button>
    </CardFooter>
  </Card>
);

/** Badges on the title line, content under it: one key of a transaction, signed and paying the fee. */
export const WithBadge = () => (
  <Card className="w-full max-w-xl">
    <CardHeader>
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle asChild>
          <h3>Main key</h3>
        </CardTitle>
        <Badge tone="success">
          <CircleCheckIcon aria-hidden="true" />
          Signed
        </Badge>
        <Badge tone="outline">
          <CoinsIcon aria-hidden="true" />
          Pays the network fee
        </Badge>
      </div>
    </CardHeader>
    <CardContent>
      <AddressText address={MAIN_KEY} variant="full" />
    </CardContent>
  </Card>
);
