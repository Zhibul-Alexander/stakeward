import { AddressText, Button, QrCode, Skeleton } from '@stakeward/design-system';
import { RotateCcwIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SAMPLE, sampleLinkUrl } from '../../apps/web/src/pages/dev-ui/samples';

// The signing link of a rescue on its durable nonce, as core builds it on the production origin.
const linkUrl = sampleLinkUrl('https://stakeward-prod.stakeward.workers.dev');

/** The /cosign link for the other device's camera: the longest link Stakeward makes, the densest code. */
export const SigningLink = () => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void linkUrl.then(setUrl);
  }, []);
  if (url === null) return <Skeleton className="aspect-square w-full max-w-80" />;
  return <QrCode value={url} label="QR code of the signing link" />;
};

/** Rescue: the New wallet's address to fund from an exchange or another wallet, with the address and a re-check. */
export const NewWalletAddress = () => (
  <div className="flex flex-col items-start gap-3 rounded-lg bg-subtle p-4">
    <p className="max-w-prose text-sm">
      Send SOL to this address from an exchange or another wallet. Not from your main key: a thief&apos;s bot may take it
      first.
    </p>
    <QrCode value={SAMPLE.newWallet} label="QR code of your new wallet's address" />
    <AddressText address={SAMPLE.newWallet} variant="full" />
    <Button variant="outline">
      <RotateCcwIcon aria-hidden="true" />
      Check the balance again
    </Button>
  </div>
);
