import { Button, LinkCard, Skeleton } from '@stakeward/design-system';
import { useEffect, useState, type ReactNode } from 'react';
import { SAMPLE, SAMPLE_TX, sampleLinkUrl } from '../../apps/web/src/pages/dev-ui/samples';

// The signing link of a rescue on its durable nonce, built by core on the production origin: the longest link
// Stakeward makes, so the densest QR code a phone has to read.
const ORIGIN = 'https://stakeward-prod.stakeward.workers.dev';
const linkUrl = sampleLinkUrl(ORIGIN);
const noop = () => undefined;

function WithLink({ children }: { children: (url: string) => ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void linkUrl.then(setUrl);
  }, []);
  if (url === null) return <Skeleton className="h-96 w-full" />;
  return <>{children(url)}</>;
}

/** What Cancel the link opens inline (folded until pressed): the deposit comes back before anything is signed. */
const cancelLink = (
  <section className="flex flex-col gap-3">
    <h4 className="text-base font-semibold">Cancel the link?</h4>
    <p className="max-w-prose text-sm">
      Cancelling closes your link-signing account, so this link stops working. Its deposit of 0.00144768 SOL comes back to
      your New wallet. If the other device already sent the transaction, that change stays.
    </p>
    <Button variant="outline" className="w-fit">
      Yes, cancel the link
    </Button>
  </section>
);

/** Waiting for the Second key's device: QR code, the link with Copy, the transaction id, and both ways out. */
export const WaitingForSecondKey = () => (
  <WithLink>
    {(url) => (
      <LinkCard
        url={url}
        signature={SAMPLE_TX}
        signers={[{ role: 'second', address: SAMPLE.secondKey }]}
        watching
        lastCheckFailed={false}
        onStopWaiting={noop}
        cancel={cancelLink}
      />
    )}
  </WithLink>
);

/** Two keys sign on the other device, and the last check could not reach the network (it keeps trying). */
export const TwoKeysNetworkUnreachable = () => (
  <WithLink>
    {(url) => (
      <LinkCard
        url={url}
        signature={SAMPLE_TX}
        signers={[
          { role: 'main', address: SAMPLE.mainKey },
          { role: 'second', address: SAMPLE.secondKey },
        ]}
        watching
        lastCheckFailed
        onStopWaiting={noop}
        cancel={cancelLink}
      />
    )}
  </WithLink>
);

/** After 30 minutes the page stops checking; the link still works, Check again starts a new watch, and both ways out stay. */
export const StoppedChecking = () => (
  <WithLink>
    {(url) => (
      <LinkCard
        url={url}
        signature={SAMPLE_TX}
        signers={[{ role: 'second', address: SAMPLE.secondKey }]}
        watching={false}
        lastCheckFailed={false}
        onStopWaiting={noop}
        onCheckAgain={noop}
        cancel={cancelLink}
      />
    )}
  </WithLink>
);
