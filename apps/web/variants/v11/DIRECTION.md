# v11 "Specimen": direction

Audience: the cautious holder signing on a Ledger, and the validator who wants exact values. Tone: a registry clerk,
calm and precise; facts first, no sales voice.
The one memorable thing: every stake account is shown as its own on-chain record, a labelled field list (Main key,
Second key, Locked until) with the facts that matter set large in a serif and everything else quiet.
Deliberately left out: hero marketing art, feature-card grids, gradients, icons as decoration, numbers that are not
read from the network or from docs/gate.md.

Design Read: accounts page and landing for cautious stake holders and validators, in a registry-record language
(labelled fields, serif facts, condensed mono addresses), dial ENERGY 1 / RHYTHM 2 / MOTION 1.

## Decisions and their one-line reasons (R-31)

- Colour: a cool blue-grey paper and one petrol-ink accent (#124559) for the screen's one action; it reads as ledger
  ink, is not the indigo of the base site, and leaves green, amber, red and blue free to mean status only.
- Type: Public Sans for UI and prose (a public-registry sans, plain and very legible at 14 px); Source Serif 4 for the
  facts (dates, SOL, headings), because a record's values should read like a printed document; Martian Mono,
  narrowed to 87.5 % width, only for addresses, because its 0/O and 1/l/I are unmistakable when a person compares
  44-character keys.
- Layout: a two-column field list (label left, value right; stacked at 360 px) is the identity motif, used on the
  landing specimen, the /app records and the summary. Sections vary between record, comparison table and plain prose.
- Spacing: records are dense inside (8 to 12 px between fields) and sit 24 to 48 px apart, so one account reads as one
  object.
- Cards: only where the thing is a real object (a stake account record, the summary of a wallet); lists of links and
  explanations stay as text with rules.
- Icons: lucide only where they carry state (status badge: word + colour + icon; lock, warning) or an action's verb;
  none in headings.
- Radius: 4 px on controls and badges, 6 px on records; nothing is pill-shaped, so a badge reads as a stamp on a
  document rather than a chip.
- Shadow: none, except the tooltip that floats; records are separated by hairlines and paper colour.
- Motion: hover and focus transitions only; the reduced-motion rule from the base stays.

## Delivery Gate (antislop, mode: during)

Evidence: `VITE_CLUSTER=devnet VITE_UI_VARIANT=v11 vite build` passes; the shoot suite (13 routes x 1280/360, light and
dark) passes with no console errors; a 360 px check found `scrollWidth` = 360 on /, /app, /protect, /withdraw,
/rescue, /learn, /recovery, /stats, /check and /cosign; Tab from the top of / reaches skip link, home, Rescue, Demo,
Try to steal it, Your accounts, Check my stake, Protect my stake, demo link, mainnet link, second-key FAQ link,
gate results link, co-sign link and the details index, each with the solid focus outline.

Block 1, Hard Gate
- R-02 PASS: no em dash in any v11 file (grep).
- R-03 PASS: no horizontal scroll at 360 px on the ten routes above; header links are 40 px tall, buttons 32 to 48 px.
- R-17 / R-36 / R-38 PASS: the only figures are docs/gate.md runs (8/8 mainnet, 28/28 devnet, 31/31 LiteSVM) and the
  SwissBorg and Step Finance amounts from CLAUDE.md; /app and /stats numbers come from the API. The hero record is
  labelled "Example record. The account and date are made up" and is aria-hidden with an sr-only summary.
- R-18 PASS: no testimonials. R-23 PASS: no new logo or image; the existing favicon mark is reused.
- R-24 / R-26 PASS: every link and button is the base app's, same routes and handlers; no new controls except links to
  existing pages and to docs/gate.md on GitHub.
- R-25 PASS: see contrast table below. R-27 PASS: record skeleton, empty state, error row and summary states kept.
- R-28 PASS: no FAQ added. R-32 PASS: base :focus-visible outline kept (ring #1d6f8c light, #7cc4d8 dark).
- R-33 PASS: all styling in source files. R-34 PASS: light and dark shot on every route.
- R-35 PASS with a limit: built, shot and tab-walked; signing flows were not clicked through with wallets (their logic
  is unchanged base code). R-37 PASS: direction written above, dials ENERGY 1 / RHYTHM 2 / MOTION 1.

Block 2, Purpose-Gate
- R-01 PASS: no gradients. R-04 PASS: lucide only for status, lock/key in the rule table, and action verbs (project
  rule). R-06 PASS: no uppercase tracked labels; mono only for addresses, with the reason above. R-07 PASS: no
  background pattern. R-08 PASS: no arrows on buttons. R-09 PASS: badges only for real status (and Devnet); no eyebrow
  pill. R-10 / R-12 / R-13 PASS: no glass, no glow, no shadow except the tooltip. R-14 PASS: no feature cards. R-19
  PASS: hover and focus transitions only. R-22 PASS: no illustrations; the only visual is the record itself.

Block 3, Liveliness: dials declared; one focal point per screen (landing: title plus specimen record; /app: the
"N of M SOL protected" line); one accent (petrol ink, the one primary button); identity motif: the record with a heavy
top rule, labelled facts and serif values, repeated on landing, /app, withdraw, extend and the summary. PASS.

Block 4: no template hero-cards-steps layout (the three-step "How it works" was replaced by the stake program's rule
table); radius 3 to 6 px, nothing pill-shaped; CTAs are the product's own ("Check my stake", "Protect my stake"); no
buzzwords; palette = ink, paper, petrol accent plus status tones. PASS.

Fixed during the gate: partial bold on "second key" (single-word accent) made whole; link buttons lost their stray
16 px indent; devnet "Go to mainnet" header link hidden below 768 px (it wrapped to its own row); record facts and
quiet fields aligned on one three-column grid.

## Contrast (contrast-check.py)

Light: ink #14191f on paper #eef1f4 15.58, on surface #fbfcfd 17.20; muted #4a5462 on paper 6.77, on surface 7.47, on
subtle #e3e8ed 6.23; white on petrol #124559 10.39; petrol on paper 9.16; ring #1d6f8c on surface 5.52; input border
#6b7684 on surface 4.49 (non-text, needs 3); warning #92400e on surface 6.90; status badges: success 6.49, warning 6.37,
neutral 7.59, info 6.62, danger 5.30.
Dark: #e8edf2 on #0f141a 15.70, on #161d25 14.42; muted #a3afbc on #0f141a 8.29, on #161d25 7.61, on #232c37 6.33;
#06232d on petrol #7cc4d8 8.35; petrol on #161d25 8.69; success 10.47, warning text on surface 11.78, info 9.72,
neutral 8.14; input border #7b8796 on #161d25 4.65.
