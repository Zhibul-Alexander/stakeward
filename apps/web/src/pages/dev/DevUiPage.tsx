import { lazy, Suspense } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/i18n';
import { PrimitivesSection } from '@/pages/dev-ui/PrimitivesSection';
import { TokensSection } from '@/pages/dev-ui/TokensSection';

// The product components pull in core's builders and inspector (the samples are real transactions): a chunk of its
// own, so the page and its heading render at once.
const ComponentsSection = lazy(() =>
  import('@/pages/dev-ui/ComponentsSection').then((module) => ({ default: module.ComponentsSection })),
);
// The flows (signing panel, protect result) build their fixtures with core too, and pull in the signing engine.
const FlowsSection = lazy(() => import('@/pages/dev-ui/FlowsSection').then((module) => ({ default: module.FlowsSection })));

// Devnet-only page: tokens and every component in every state (CLAUDE.md section 9). It replaces Storybook: screenshots
// and the accessibility check run on it (e2e/dev-ui.spec.ts). Loaded lazily from routes.tsx behind the literal
// VITE_CLUSTER check, so the mainnet bundle does not contain it or src/pages/dev-ui (test/build-output.test.ts).
export const DEV_UI_MARKER = 'stakeward-dev-only:dev-ui';

const SECTIONS = [
  ['tokens', 'devUi.tokens'],
  ['primitives', 'devUi.primitives'],
  ['components', 'devUi.productComponents'],
  ['signing', 'devUi.signing'],
  ['protect-result', 'devUi.protectResult'],
] as const;

function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner className="size-6 text-muted" />
    </div>
  );
}

export default function DevUiPage() {
  return (
    <div data-marker={DEV_UI_MARKER} className="flex flex-col gap-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold">{t('devUi.title')}</h1>
        <p className="text-muted">{t('devUi.intro')}</p>
        <nav aria-label={t('devUi.toc')}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SECTIONS.map(([id, key]) => (
              <li key={id}>
                <a href={`#${id}`} className="rounded-sm text-primary underline underline-offset-4 hover:text-primary-hover">
                  {t(key)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <TokensSection />
      <PrimitivesSection />
      <Suspense fallback={<Loading />}>
        <ComponentsSection />
      </Suspense>
      <Suspense fallback={<Loading />}>
        <FlowsSection />
      </Suspense>
    </div>
  );
}
