import { useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createBrowserPorts, PortsProvider, type Ports } from '@/ports';
import { AppRoutes } from '@/routes';

/**
 * The site: ports (chain, wallets, key slots, device memory) for every page, then the layout and the routes.
 * main.tsx passes the production ports; without them (tests of the shell) the browser ports are created here.
 */
export function App({ ports }: { ports?: Ports | undefined }) {
  const [value] = useState(() => ports ?? createBrowserPorts());
  return (
    <PortsProvider ports={value}>
      <TooltipProvider>
        <Layout>
          <AppRoutes />
        </Layout>
      </TooltipProvider>
    </PortsProvider>
  );
}
