import { AddressText, Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from '@stakeward/design-system';
import { CircleCheckIcon, FileTextIcon } from 'lucide-react';

const TX = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';

/**
 * A hairline over the card's own action, the one filled button. A page's way out (Back) is not a footer action: it
 * sits in its own row under the card.
 */
export const PrimaryAction = () => (
  <div className="flex w-full max-w-md flex-col gap-4">
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h3>Set up signing by link</h3>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="max-w-prose text-sm">
          A link needs a small signing account so it stays valid for hours. Your Main key pays a 0.00144768 SOL deposit,
          returned when you close it.
        </p>
      </CardContent>
      <CardFooter>
        <Button>Create the link-signing account</Button>
      </CardFooter>
    </Card>
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost">Back</Button>
    </div>
  </div>
);

/** A footer without a filled button: an outline action, then a ghost action with a leading icon. */
export const NoFilledButton = () => (
  <Card className="w-full max-w-xl">
    <CardHeader>
      <CardTitle asChild className="flex items-start gap-2">
        <h3>
          <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          The lock now ends on 10 April 2027
        </h3>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="text-muted">Transaction</span>
        <AddressText address={TX} kind="tx" />
      </p>
    </CardContent>
    <CardFooter>
      <Button variant="outline">Back to your accounts</Button>
      <Button variant="ghost">
        <FileTextIcon aria-hidden="true" />
        Print the updated recovery card
      </Button>
    </CardFooter>
  </Card>
);
