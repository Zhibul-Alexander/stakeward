import { AddressText, Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from '@stakeward/design-system';

const MAIN_KEY = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';
const SECOND_KEY = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi';

/*
 * The site's own screens draw their framed panels with the same tokens (a hairline frame on the surface, no shadow)
 * but without this component. These cards hold the words and actions of those panels.
 */

/**
 * Header, content and footer: the panel that sets up signing by link, with what it costs and its one filled button.
 */
export const Default = () => (
  <Card className="w-full max-w-md">
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
);

/** An action that is not the screen's goal stays outline: closing the link-signing account after a rescue. */
export const OutlineAction = () => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle asChild>
        <h3>Close the link-signing account</h3>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <p className="max-w-prose text-sm">
        Closing returns 0.00144768 SOL to your New wallet. Any link still open stops working.
      </p>
    </CardContent>
    <CardFooter>
      <Button variant="outline">Close it</Button>
    </CardFooter>
  </Card>
);

/** Content as label and value rows: the two keys of a lock, each address in full with what it does. */
export const WithDetails = () => (
  <Card className="w-full max-w-xl">
    <CardHeader>
      <CardTitle asChild>
        <h3>Keys</h3>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <dl className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-1">
          <dt className="font-semibold">Main key</dt>
          <dd className="flex flex-col gap-1">
            <AddressText address={MAIN_KEY} variant="full" explorer />
            <p className="text-sm text-muted">
              Withdraws the SOL, together with the second key while the lock holds. If it is lost, nobody can withdraw
              this stake. The Solana command line calls it the withdraw authority.
            </p>
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-semibold">Second key</dt>
          <dd className="flex flex-col gap-1">
            <AddressText address={SECOND_KEY} variant="full" explorer />
            <p className="text-sm text-muted">
              Co-signs; it cannot move SOL alone and is not a backup of the main key. The Solana command line calls it the
              lockup custodian.
            </p>
          </dd>
        </div>
      </dl>
    </CardContent>
  </Card>
);
