import { Button, Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@stakeward/design-system';
import { ShieldCheckIcon } from 'lucide-react';

/** `asChild` makes the title the page's heading at the right level; it keeps the card's size and weight. */
export const AsHeading = () => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle asChild>
        <h3>Close the link-signing account</h3>
      </CardTitle>
      <CardDescription>Closing returns 0.00144768 SOL to your New wallet. Any link still open stops working.</CardDescription>
    </CardHeader>
    <CardFooter>
      <Button variant="outline">Close it</Button>
    </CardFooter>
  </Card>
);

/** A title with a leading status icon, the status's hint under it: a protected stake account. */
export const WithIcon = () => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle asChild className="flex items-center gap-2">
        <h3>
          <ShieldCheckIcon aria-hidden="true" className="size-5 shrink-0 text-success" />
          Protected
        </h3>
      </CardTitle>
      <CardDescription>Withdrawing or changing the owner needs your second key until 12 April 2027.</CardDescription>
    </CardHeader>
  </Card>
);
