import { useState } from 'react';
import { DevCosign } from '@/pages/dev-cosign/DevCosign';
import { createDevCosignPorts } from '@/pages/dev-cosign/ports';

// Devnet-only page: two wallets co-sign one SetLockupChecked (CLAUDE.md section 10, step 3, the wallet matrix).
// Loaded lazily from routes.tsx behind the literal VITE_CLUSTER check, so the mainnet bundle contains neither this
// page nor src/pages/dev-cosign (test/build-output.test.ts).
export const DEV_COSIGN_MARKER = 'stakeward-dev-only:dev-cosign';

export default function DevCosignPage() {
  // Its own ports: HttpChain, Wallet Standard wallets, and slots kept apart from the product's (dev-cosign/ports.ts).
  const [ports] = useState(() => createDevCosignPorts());
  return (
    <div data-marker={DEV_COSIGN_MARKER}>
      <DevCosign {...ports} />
    </div>
  );
}
