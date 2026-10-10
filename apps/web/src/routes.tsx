import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Switch } from 'wouter';
import { Spinner } from '@/components/ui/spinner';
import { AppPage } from '@/pages/AppPage';
import { CheckPage } from '@/pages/CheckPage';
import { CosignPage } from '@/pages/CosignPage';
import { DemoPage } from '@/pages/DemoPage';
import { ExtendPage } from '@/pages/ExtendPage';
import { LandingPage } from '@/pages/LandingPage';
import { LearnPage } from '@/pages/LearnPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProofPage } from '@/pages/ProofPage';
import { ProtectPage } from '@/pages/ProtectPage';
import { RecoveryPage } from '@/pages/RecoveryPage';
import { RescueKitPage, RescueNowPage } from '@/pages/RescueKitPage';
import { RescuePage } from '@/pages/RescuePage';
import { StatsPage } from '@/pages/StatsPage';
import { StealPage } from '@/pages/StealPage';
import { WithdrawPage } from '@/pages/WithdrawPage';

// Devnet-only pages (CLAUDE.md section 9). The literal comparison (not IS_DEVNET from config.ts) is what lets the
// bundler drop these imports from a mainnet build: Vite turns it into "mainnet" === "devnet", the branch is dead and
// the chunks are never emitted. test/build-output.test.ts builds both clusters and checks it.
const DEV_PAGES = import.meta.env.VITE_CLUSTER === 'devnet';
const DevUiPage = DEV_PAGES ? lazy(() => import('@/pages/dev/DevUiPage')) : null;
const DevCosignPage = DEV_PAGES ? lazy(() => import('@/pages/dev/DevCosignPage')) : null;

function Lazy({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Spinner className="size-6 text-muted" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/** Every route of CLAUDE.md section 9. Unknown paths get a not-found page with a way back. */
export function AppRoutes() {
  return (
    <Switch>
      <Route path="/">
        <LandingPage />
      </Route>
      <Route path="/learn/:tab?">
        <LearnPage />
      </Route>
      <Route path="/app">
        <AppPage />
      </Route>
      <Route path="/protect">
        <ProtectPage />
      </Route>
      <Route path="/withdraw/:account">
        <WithdrawPage />
      </Route>
      <Route path="/extend/:account">
        <ExtendPage />
      </Route>
      <Route path="/rescue">
        <RescuePage />
      </Route>
      <Route path="/rescue-kit">
        <RescueKitPage />
      </Route>
      <Route path="/rescue-kit/:account">
        <RescueNowPage />
      </Route>
      <Route path="/cosign">
        <CosignPage />
      </Route>
      <Route path="/try-steal/:account">
        <StealPage />
      </Route>
      <Route path="/recovery/:account">
        <RecoveryPage />
      </Route>
      <Route path="/demo">
        <DemoPage />
      </Route>
      <Route path="/proof/:wallet">
        <ProofPage />
      </Route>
      <Route path="/stats">
        <StatsPage />
      </Route>
      <Route path="/check">
        <CheckPage />
      </Route>
      {DevUiPage === null ? null : (
        <Route path="/dev/ui">
          <Lazy>
            <DevUiPage />
          </Lazy>
        </Route>
      )}
      {DevCosignPage === null ? null : (
        <Route path="/dev/cosign">
          <Lazy>
            <DevCosignPage />
          </Lazy>
        </Route>
      )}
      <Route>
        <NotFoundPage />
      </Route>
    </Switch>
  );
}
