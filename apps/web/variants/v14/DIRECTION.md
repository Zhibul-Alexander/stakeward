# v14 "Evidence"

Audience: skeptical judges, validators and security people who assume every security claim is marketing until shown otherwise.
Tone: a test report, not a pitch. Plain sentences, dates, error names, signatures. No adjectives that a transaction cannot back.
The one memorable thing: every claim sits next to the transaction that tested it (check number, what was tried, the error the program returned, and the explorer link), including the claims about what the lock does NOT stop.
Deliberately left out: feature cards, a three-step "how it works", illustrations, invented numbers, a "trusted by" row, decoration of any kind. If a sentence has no check or live API value behind it, it is either a plain product rule or it is gone.

Design Read: a security product's landing and accounts pages for technical skeptics, in a "lab record" language (serif claims, sans record, mono only for signatures/error names/addresses), dial ENERGY 1 / RHYTHM 2 / MOTION 1.

## Decisions (one line each, R-31)

- Colour: cool grey sheet `#f2f4f3`, white panels, ink `#14191b`, one petrol primary `#0b5462` (dark: `#7cc6d3`): reads as a document, avoids the indigo of the base and the cream/terracotta default. Status tones only mean state.
- Type: Source Serif 4 for h1/h2 and claims (the voice of a written report), Public Sans for interface and record text (plain, made for public-service forms), IBM Plex Mono only for signatures, error names, addresses and the lock field (values compared character by character). Fallback @font-face with size-adjust keeps the swap from shifting layout.
- Layout: the landing is a ledger. Claim on the left, the checks behind it on the right (5fr/7fr from 1024 px, stacked below). Hairlines, not cards, because it is a table of records.
- The one deliberate accent: the hero's bordered "Tested on Solana mainnet" panel next to the h1; everything else is flat.
- Identity motif: "Check N", what was tried, "Refused with `Error`" or "Went through", then a tick per network with the transaction link. Repeated on every claim, in the hero and in the incidents.
- Limits get their own subtle panel (the only filled section in the record) so the honest limit cannot be skimmed as more good news.
- First check per claim visible, the rest behind a native `<details>`: every proof is one keyboard press away and the page stays readable.
- Accounts page: every row ends with a dashed "network record" line (lock in force or not, the raw lock field and its date, cluster time of the read, the second key where the row does not already show it); the summary says where the answer came from next to "Last checked".
- Icons (lucide, project rule): BanIcon = refused, CircleCheck = went through, Check = matched expectation, ExternalLink = opens explorer/source in a new tab, X = cannot do. Nothing decorative.
- Motion: none added (MOTION 1); the details chevron rotates on open, which reduced motion turns off.

## Facts used and where they come from

- Checks, signatures, run dates and counts (31/31, 28/28, 8/8), program sha256, mainnet run fees 0.0000648 SOL: docs/gate.md.
- SwissBorg (8 Sep 2025, 192,600 SOL, hidden withdraw-key change approved by its own signers) and Step Finance (31 Jan 2026, 261,854 SOL, executives' devices): docs/SUBMISSION.md wording and links (Kiln post-mortem, The Block). Step Finance is explicitly "nothing claimed", as that file instructs.
- Live numbers: GET /api/stats and GET /api/health through the existing fetchStats/useLoad and useHealth/MonitoringStatus. Rendered as returned, with loading, error (Try again) and empty states.

## Delivery Gate (antislop, mode: during)

Block 1, Hard Gate (all must be "no"):
- R-02 em dash: PASS. `grep` for U+2014/U+2013 in variants/v14 (excluding .md) finds none.
- R-03 mobile: PASS. Shot at 360 px on all 13 routes; scripted check `scrollWidth > innerWidth` is false; record links and summaries are min 44 px tall below 640 px.
- R-17 numbers: PASS. Every number is from docs/gate.md, docs/SUBMISSION.md sources, or the live API.
- R-18 testimonials: PASS. None.
- R-23 assets: PASS. No new logo or image; the existing favicon mark is kept; graphics are none.
- R-24 nav: PASS. Header nav unchanged (real routes); footer gains "Test record" (GitHub docs/gate.md, exists).
- R-25 contrast: PASS. contrast-check.py on 15 pairs per theme, lowest 4.66:1 (border-strong on surface), text pairs 5.60:1 and up. Numbers in the report.
- R-26 dead controls: PASS. Every new control is a link (route, #record anchor, explorer, source) or a native details toggle.
- R-27 states: PASS. Live block: loading (spinner + skeleton), error (message + Try again), empty (stats.emptyBody). Accounts page states unchanged.
- R-28 FAQ: PASS. FAQ untouched (lives on /learn).
- R-32 keyboard: PASS. Tab order follows visual order (recorded: skip link, logo, header nav, Check my stake, Protect my stake, demo, mainnet, hero transaction, "See the other 23 checks below", stats link); all 6 details opened with Enter; global :focus-visible outline kept.
- R-33 patch scripts: PASS. All code written in source files of variants/v14.
- R-34 themes: PASS. Light and dark shot on all routes, no breakage; same contrast checks.
- R-35 verified: PASS. Built, shot 26 light + 26 dark screenshots with no console errors; click-through: "See the other checks below" -> #record; 6 summaries -> open; 31 explorer links (8 mainnet) well-formed; Check my stake -> /app; Protect my stake -> /protect; 0 console errors; no overflow at 360 and 1280.
- R-36 fabricated claims: PASS. Step Finance is marked "Nothing claimed"; no compliance or performance claims.
- R-37 direction: PASS. Direction pre-resolved by the brief and written at the top of this file.
- R-38 realistic fabrication: PASS. Nothing invented; the mock API values in screenshots come from the e2e mock, the page renders whatever the API returns.

Block 2, Purpose-Gate: PASS on all. No gradients, glows, glass, background grid, eyebrow pill, arrows on buttons or illustrations. Icons and mono usage have written reasons above. Shadows: only popovers. Cards: the claim records are rows, not identical feature cards; the two incident columns are a deliberate pair of the same kind of record.

Block 3, Liveliness: PASS. Dials declared (ENERGY 1 / RHYTHM 2 / MOTION 1); sections vary (hero split, live band, ledger, limits panel, two-column incidents, list, callout); one focal point per screen (h1 + mainnet proof on the landing, the "N of M SOL protected" answer on /app); one accent (the hero proof panel); motif repeated.

Block 4, Craftsmanship: PASS. No template hero + 3 cards + 3 steps; CTAs are product-specific ("Check my stake", "Protect my stake"); no buzzwords; palette 1 core + 1 accent + state tones; not a clone of a known product.

Fixed during the gate: header wrapped to two rows at 1280 with a larger serif wordmark (reduced); hero h1 squeezed into a 5-line column (moved to full width); first visible proof of "get around the lock" was a success (reordered so a refusal leads); incident verdict boxes misaligned (subgrid); network-record line cramped in the narrow flow column (flex-wrap); temporary click-through spec removed from variants/shoot.
