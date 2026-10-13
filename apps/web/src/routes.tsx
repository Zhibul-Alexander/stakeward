import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Switch } from 'wouter';
import { PageMeta } from '@/components/layout/PageMeta';
import { Spinner } from '@/components/ui/spinner';
import { AppPage } from '@/pages/AppPage';
import { ChangeKeyPage } from '@/pages/ChangeKeyPage';
import { CheckPage } from '@/pages/CheckPage';
import { CosignPage } from '@/pages/CosignPage';
import { DelegatePage } from '@/pages/DelegatePage';
import { DemoPage } from '@/pages/DemoPage';
import { ExtendPage } from '@/pages/ExtendPage';
import { LandingPage } from '@/pages/LandingPage';
import { LearnPage, learnTab } from '@/pages/LearnPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProofPage } from '@/pages/ProofPage';
import { ProtectPage } from '@/pages/ProtectPage';
import { RecoveryPage } from '@/pages/RecoveryPage';
import { RescueKitPage, RescueNowPage } from '@/pages/RescueKitPage';
import { RescuePage } from '@/pages/RescuePage';
import { StakePage } from '@/pages/StakePage';
import { StatsPage } from '@/pages/StatsPage';
import { StealPage } from '@/pages/StealPage';
import { WithdrawPage } from '@/pages/WithdrawPage';

// Devnet-only pages (CLAUDE.md section 9). The literal comparison (not IS_DEVNET from config.ts) is what lets the
// bundler drop these imports from a mainnet build: Vite turns it into "mainnet" === "devnet", the branch is dead and
// the chunks are never emitted. test/build-output.test.ts builds both clusters and checks it.
const DEV_PAGES = import.meta.env.VITE_CLUSTER === 'devnet';
const DevUiPage = DEV_PAGES ? lazy(() => import('@/pages/dev/DevUiPage')) : null;
const DevCosignPage = DEV_PAGES ? lazy(() => import('@/pages/dev/DevCosignPage')) : null;
/** The public challenge wallet of this build's cluster (D133, D154), in a chunk of its own. */
const ChallengePage = lazy(() => import('@/pages/challenge/ChallengePage'));

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

/**
 * Every route of CLAUDE.md section 9. Unknown paths get a not-found page with a way back. PageMeta, first in each route,
 * sets the tab title, description and canonical link (page-meta.ts, DECISIONS D156); a page may still set its own title
 * after it, as the recovery card does.
 */
export function AppRoutes() {
  return (
    <Switch>
      <Route path="/">
        <PageMeta page="landing" />
        <LandingPage />
      </Route>
      <Route path="/learn/:tab?">
        {(params) => (
          <>
            <PageMeta page={`learn.${learnTab(params.tab)}`} />
            <LearnPage />
          </>
        )}
      </Route>
      <Route path="/app">
        <PageMeta page="app" />
        <AppPage />
      </Route>
      <Route path="/protect">
        <PageMeta page="protect" />
        <ProtectPage />
      </Route>
      <Route path="/withdraw/:account">
        <PageMeta page="withdraw" />
        <WithdrawPage />
      </Route>
      <Route path="/extend/:account">
        <PageMeta page="extend" />
        <ExtendPage />
      </Route>
      <Route path="/change-key/:account">
        <PageMeta page="changeKey" />
        <ChangeKeyPage />
      </Route>
      <Route path="/delegate/:account">
        <PageMeta page="delegate" />
        <DelegatePage />
      </Route>
      <Route path="/stake">
        <PageMeta page="stake" />
        <StakePage />
      </Route>
      <Route path="/rescue">
        <PageMeta page="rescue" />
        <RescuePage />
      </Route>
      <Route path="/rescue-kit">
        <PageMeta page="rescueKit" />
        <RescueKitPage />
      </Route>
      <Route path="/rescue-kit/:account">
        <PageMeta page="rescueNow" />
        <RescueNowPage />
      </Route>
      <Route path="/cosign">
        <PageMeta page="cosign" />
        <CosignPage />
      </Route>
      <Route path="/try-steal/:account">
        <PageMeta page="trySteal" />
        <StealPage />
      </Route>
      <Route path="/recovery/:account">
        <PageMeta page="recovery" />
        <RecoveryPage />
      </Route>
      <Route path="/demo">
        <PageMeta page="demo" />
        <DemoPage />
      </Route>
      <Route path="/proof/:wallet">
        <PageMeta page="proof" />
        <ProofPage />
      </Route>
      <Route path="/stats">
        <PageMeta page="stats" />
        <StatsPage />
      </Route>
      <Route path="/check">
        <PageMeta page="check" />
        <CheckPage />
      </Route>
      <Route path="/challenge">
        <PageMeta page="challenge" />
        <Lazy>
          <ChallengePage />
        </Lazy>
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
        <PageMeta page="notFound" />
        <NotFoundPage />
      </Route>
    </Switch>
  );
}
