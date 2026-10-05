import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Switch } from 'wouter';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/i18n';
import { AppPage } from '@/pages/AppPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { CosignPage } from '@/pages/CosignPage';
import { ExtendPage } from '@/pages/ExtendPage';
import { LandingPage } from '@/pages/LandingPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ProtectPage } from '@/pages/ProtectPage';
import { RescuePage } from '@/pages/RescuePage';
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
      <Route path="/cosign">
        <CosignPage />
      </Route>
      <Route path="/recovery/:account">
        <ComingSoonPage title={t('common.pages.recovery')} />
      </Route>
      <Route path="/stats">
        <ComingSoonPage title={t('common.pages.stats')} />
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
