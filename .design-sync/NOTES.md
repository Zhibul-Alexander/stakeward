# design-sync notes: Stakeward

## How this repo becomes a "package"

- apps/web is a site, not a published library: no dist/, no .d.ts. `node .design-sync/build-package.mjs` (cfg.buildCmd)
  compiles the site's own component source (components/ui, components/product, layout Page/PageHeader/Section) into
  apps/web/.ds-pkg/ (gitignored) with Vite in lib mode (the site's React + Tailwind plugins, `@/` alias,
  VITE_CLUSTER=mainnet) and tsc declarations. Run it before the converter whenever apps/web/src changed.
- dist/index.js keeps every npm dependency as an import (like a published library). Bundling them in Vite left
  CommonJS `require("react")` calls that the converter's React shim cannot reach ("Dynamic require of react").
- tsc emits declarations rooted at the repo (types/apps/web/src/...); the script rewrites `@/` and `.ts(x)` import
  specifiers to plain relative ones, since ts-morph knows neither.
- Vite lib mode inlines fonts as data URIs and the converter drops those @font-face blocks ("11 dead @font-face
  block(s) dropped" is expected). Geist comes from cfg.extraFonts (@fontsource-variable css + woff2), the same files the
  site serves.
- Run the converter from the repo root with `--node-modules apps/web/node_modules` (no --entry flag: cfg.entry).
- No cfg.tsconfig: the converter's paths plugin resolves `@/i18n` to the directory instead of i18n/index.ts. esbuild's
  own per-file tsconfig lookup already resolves `@/` inside apps/web/src, which is all previews need.
- Groups: ui primitives -> "primitives" through the category stub .design-sync/docs/primitives.md (cfg.docsMap: the
  converter treats a ui/ dir as generic); product parts whose names do not match their file are pinned with
  cfg.componentSrcMap so they group under "product" and get their JSDoc.
- The render check needs `LD_LIBRARY_PATH=$PWD/.cache/pw-libs/root/usr/lib/x86_64-linux-gnu` (scripts/playwright-local-libs.sh)
  and playwright 1.63.0 in .ds-sync (matches the cached chromium-1243).

- Icons: build-package.mjs writes apps/web/.ds-pkg/icons.js re-exporting every lucide-react icon the site imports;
  cfg.extraEntries ["./icons.js"] merges them into window.Stakeward (61 icons on 2026-10-09; 149 exports in all).
  Changing extraEntries changes the preview-import contract: every grade is cleared and all cards must be re-graded.
- The conventions header (.design-sync/conventions.md, cfg.readmeHeader) names only components, icons and classes
  checked against the built ds-bundle; re-check it after any token, class or component rename.

## Authoring previews

- Import components from '@stakeward/design-system' (window.Stakeward). Fixtures come from the site's own /dev/ui
  samples: `import { ... } from '../../apps/web/src/pages/dev-ui/samples'` (sampleRows, sampleSummaries, sampleSigners,
  sampleJobs, sampleRecoveryCard, SAMPLE addresses, SAMPLE_TX, SAMPLE_ERROR_DETAIL ...). Composition reference: the
  /dev/ui sections apps/web/src/pages/dev-ui/{ComponentsSection,PrimitivesSection,LayoutSection,FlowsSection}.tsx.
- Use a fixed clock `{ unixTimestamp: 1_791_504_000n, epoch: 850n }` (9 October 2026): sampleClock() reads Date.now and
  would move the dates on every capture.
- Copy is English and matches apps/web/src/i18n/en.json; role names are Main key, Second key, New wallet.
- Async fixtures (sampleSummaries) go through a small useEffect wrapper that shows the component's Skeleton until ready.
- Captures use a 900x700 window; a taller component needs cfg.overrides.<Name>.viewport (TransactionSummary: 900x1500).
- The library stylesheet carries a utility vocabulary (`@source inline()` in build-package.mjs): layout, spacing,
  sizing, type, colour tokens as bg/text/border, sm/md/lg for layout. A preview or a design may use those; anything
  else must already occur in apps/web/src or it generates no CSS, silently. `cn()` (tailwind-merge) still drops the
  component's own conflicting class, so an override with a missing class removes the style and adds nothing. Check a
  doubtful class with `grep -c '\.<escaped>' ds-bundle/_ds_bundle.css` before relying on it.
- Fixtures that work in previews: dev-ui samples (sampleRows, sampleSummaries, sampleSigners, sampleJobs,
  sampleLinkUrl, sampleRecoveryCard, SAMPLE_WALLETS with their .svg icons), `@stakeward/core` helpers
  (recoveryCommands, cliUrl, LEDGER_PUBKEY_COMMAND, formatSol), lucide-react icons, and site modules the DS does not
  export (e.g. pages/app/MonitoringStatus for SummaryBar's `monitoring` slot: its own component imports are redirected
  to window.Stakeward by story-imports rule 2).
- Keep captures deterministic: Countdown and MonitoringStatus take a clock/now prop; pass fixed values
  (1_791_504_000_000 ms). Link-signing previews use the prod origin https://stakeward-prod.stakeward.workers.dev, not
  window.location.origin.
- Period end dates under the fixed clock (core lockupEndForPeriod): 1 month = 10 November 2026, 3 = 10 January 2027,
  6 = 10 April 2027, 12 = 10 October 2027; sampleExpiringEnd = 28 October 2026. formatSol drops trailing zeros
  ("1,250.5 SOL"); short addresses are first 3 + "..." + last 3 (core shortAddress).
- Follow the product, not /dev/ui, where they differ: copy comes from en.json as the pages render it, rows get the
  actions /app gives them (pages/app/AccountsResults.tsx: a Protected row's Extend is behind More, only an Expiring row
  shows Extend), at most one filled button per cell (D112), no made-up strings.
- Never name a story export `Error` (shadows the global).
- One cell is a 900x700 window and clips anything taller without a warning: about 4 full SignerList cards, 6
  JobStatusList rows or one TransactionSummary skeleton fit. Taller compositions need cfg.overrides.<Name>.viewport.
- Open tooltips are portalled with fixed coordinates: the Tooltip family is cardMode single.
- Not rendered statically, by design: hover and focus states; the <640 px layouts of StepProgress and ActionBar (a media
  query, not container width, so a 900 px capture never shows them); AccountRowError's open Details (native <details>,
  no open prop).
- preview-rebuild of a component that imports dev-ui samples takes minutes (it bundles core and the Solana libraries);
  a full package-build of all 72 previews takes over 10 minutes. Run long builds in the background.

## What the product actually uses (graders check previews against this)

- Previews may import pages/app/view.ts (buildAccountsView, attentionNote, protectableInGroup, stakeKeyChanged,
  appLinks): it pulls only @stakeward/core, so /app groups, the one filled button, totals and new-device numbers come
  from the product's own logic. Use it for any /app composition.
- /app row actions (pages/app/AccountsResults.tsx): unprotected rows keep Protect (again) behind More, visible only on a
  service-managed row; a Protected row has Extend, Withdraw and Recovery card behind More; only an Expiring row shows
  Extend; a stake-key-changed row leads with Rescue; a lock held by another key has no action.
- /protect's selectable rows are a custom <li> (bg-primary-soft when chosen, whole-row toggle); locks held by another key
  sit in their own group without checkboxes, never as disabled checkboxes.
- Not used by any product screen (DS states only; previews say so and invent no product context): the Card family,
  Button variant link and size icon, Badge tone primary, Alert tone success (only /dev/cosign), Disclosure variant row
  (the FAQ uses FaqItem), Progress, Tooltip (only App.tsx mounts TooltipProvider), AccountRowError, AddressTextSkeleton,
  StatusBadgeSkeleton, CountdownSkeleton, KeyListSkeleton, CommandBlockSkeleton, SignerList variant full (SigningPanel
  uses compact), WalletSlot status loading, StepProgress failed (only /dev/cosign), TransactionSummaryError (only
  /dev/cosign; the signing panel shows inspector refusals as ErrorState, /cosign as StopPanel), the QrCode too-long
  fallback (link.test.ts proves the largest transaction still fits). Never rendered: a disabled Checkbox, Input or
  whole RadioGroup, aria-invalid radios; AccountRow hint={true}.
- Separator appears only inside RadioCardGroup, before a danger option. RadioCardGroup shows its legend only in
  SignWhere; protect and extend use legendHidden under an h2.
- en.json keys under devUi.sample.* are /dev/ui copy, not product copy (stepSign, connectionLost, protectTwo,
  firstSigner ...). Product step labels: protect.steps (last is "Review and sign"), rescue.steps.
- Only /recovery has a PageHeader action (primary Print + printHint); /app's header is title + lead, Refresh is an
  icon-only ghost in the SummaryBar tools. No product header combines back and progress.
- dev-ui SAMPLE_LOCK_END is 12 April 2027; under the fixed clock a 6-month lock ends 10 April 2027 (1_807_315_200n).
  The link-signing deposit is formatSol(1_447_680n) = 0.00144768 SOL. FAQ params as the landing fills them: {days} =
  "30, 14, 7, 3, and 1", {rescueMax} = 10, {rescueAmount} = 0.01 SOL; FAQ group sizes basics 7, keys 12, signing 6,
  costs 4, developers 6.

## Contracts (.d.ts)

- The converter prints domain types by name (SignerListItem, JobStatusItem, RadioCardOption, InspectedSummary ...)
  without their shape. cfg.dtsPropsFor carries structural bodies for the 11 components that take them (AccountRow,
  CosignRequest, EmptyState, JobStatusList, KeyList, LinkCard, RadioCardGroup, SignerList, StopPanel, TransactionSummary,
  TransactionSummaryError). They were generated from the emitted bodies with the types written out; when a prop type
  changes in source, update the matching dtsPropsFor entry by hand. `CSSProperties` on primitives' `style` stays bare
  (React.CSSProperties; self-explanatory).

## Grading mechanics

- A carried-forward component writes no review sheet. To regrade one (after a CSS change, or on request), run
  `package-capture.mjs --out ./ds-bundle --components <Name> --force`; it clears that grade and captures a fresh sheet.
- Several preview-rebuilds in parallel contend for esbuild: 14 components without sample imports took ~13 minutes.

## Product issues seen while syncing (for the owner, not fixed here)

- SummaryBar's docstring says `action` is for "Connect second key" and `footer` holds the rescue line; /app passes the
  rescue note as `action` and uses neither footer nor a Connect button in the bar.
- CountdownSkeleton draws 2 bars (label, time) but Countdown renders 3 lines (label, time, "Around HH:MM UTC on
  <date>"), a ~20 px layout shift when it loads.
- On the selected lock-period card (bg-primary-soft) PeriodStep's inline date Skeleton (bg-subtle) is nearly invisible
  while the network time loads.

## Re-sync risks (watch-list for the next run)

- Run `node .design-sync/build-package.mjs` first whenever apps/web/src changed: the converter reads apps/web/.ds-pkg,
  which is gitignored and goes stale silently.
- cfg.dtsPropsFor bodies are hand-maintained copies of 11 components' props with domain types written out. A prop
  change in source (account-row, cosign-request, empty-state, job-status-list, key-list, link-card, radio-card,
  signer-list, stop-panel, transaction-summary) is NOT picked up: update the entry.
- Previews import dev-ui fixtures (pages/dev-ui/samples.ts) and pages/app/view.ts. Edits there change the cards (the
  grades key on the preview sources, not on these imports): skim the review sheets after such edits.
- The utility vocabulary (`@source inline()` in build-package.mjs) is an assumption about what designs need; a class
  outside it and outside the site source compiles to nothing, silently.
- Converter quirks worked around, not fixed: cfg.tsconfig resolves `@/i18n` to a directory (left unset); Vite lib mode
  inlines fonts as data URIs (fonts come from cfg.extraFonts); DOM attributes of primitives are dropped from .d.ts by
  design (the conventions header says they pass through).
- Not machine-checked: the <640 px layouts (captures are 900 px wide) and hover/focus states.
- Toolchain at this sync: Node 24.21, pnpm, Vite 8.3, Tailwind 4.3.3, playwright 1.63 with chromium-1243 in
  ~/.cache/ms-playwright, LD_LIBRARY_PATH from scripts/playwright-local-libs.sh.

## Known render warns

- None open: the four [GRID_OVERFLOW] cards (Skeleton, SolAmount, SolAmountSkeleton, SupportBadge) are column cards.
