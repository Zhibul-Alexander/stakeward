import { Button, Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@stakeward/design-system';
import { CalendarPlusIcon, ShieldAlertIcon } from 'lucide-react';

/** Muted, smaller text under the title: what the panel is for and what it costs (a rescue's link-signing account). */
export const UnderTitle = () => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle asChild>
        <h3>Set up the link-signing account</h3>
      </CardTitle>
      <CardDescription>
        Rescue always signs through a small signing account, so three wallets have time to sign. Your New wallet pays a
        0.00144768 SOL deposit, returned when you close it.
      </CardDescription>
    </CardHeader>
    <CardFooter>
      <Button>Create the link-signing account</Button>
    </CardFooter>
  </Card>
);

/** A status and its one-sentence hint: a lock that ends within 30 days, with Extend as its row on /app offers it. */
export const StatusHint = () => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle asChild className="flex items-center gap-2">
        <h3>
          <ShieldAlertIcon aria-hidden="true" className="size-5 shrink-0 text-warning" />
          Expiring soon
        </h3>
      </CardTitle>
      <CardDescription>The lock ends on 28 October 2026. Extend it to stay protected.</CardDescription>
    </CardHeader>
    <CardFooter>
      <Button size="sm" variant="outline">
        <CalendarPlusIcon aria-hidden="true" />
        Extend
      </Button>
    </CardFooter>
  </Card>
);
