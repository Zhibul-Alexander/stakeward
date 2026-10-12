import { useState } from 'react';
import { Layout } from '@/components/layout/Layout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLocale } from '@/i18n';
import { createBrowserPorts, PortsProvider, type Ports } from '@/ports';
import { AppRoutes } from '@/routes';

/**
 * The site: ports (chain, wallets, key slots, device memory) for every page, then the layout and the routes.
 * main.tsx passes the production ports; without them (tests of the shell) the browser ports are created here.
 * App reads the interface language: when the footer switches it, App re-renders and with it every page, whose state
 * stays as it was (D140).
 */
export function App({ ports }: { ports?: Ports | undefined }) {
  const [value] = useState(() => ports ?? createBrowserPorts());
  useLocale();
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
