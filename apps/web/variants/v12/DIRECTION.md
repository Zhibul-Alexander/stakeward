# v12 "Field manual"

Audience: a holder of native stake who will only trust a lock they can open without us; tone: an operations manual, calm and imperative, situation then numbered steps.
The one memorable thing: the landing page is the manual itself: seven numbered procedures (P1 to P7) with the real Solana CLI commands from the recovery card, and every account on /app points at its next procedure.
Deliberately left out: hero illustration, feature cards, three-step "how it works", marketing adjectives, gradients, decorative icons.
Reading this as: a reference manual for cautious stakers, in a printed-procedure language (ink rules, thumb-index tabs, mono only for commands and addresses), dial ENERGY 1 / RHYTHM 2 / MOTION 1.

## Decisions (R-31, one line each)
- Colour: ink on grey-green paper because a manual is printed matter; the only non-status colour is caution yellow, used once, on the plate that states the second key's limit.
- Primary buttons are ink, not a brand hue: the procedure tab and the buttons share the same ink, so the manual reads as one voice.
- Type: Atkinson Hyperlegible (Braille Institute, built for low vision) for all prose, because this page is read when a key was just stolen; IBM Plex Mono only for commands, addresses and procedure codes, which a reader may have to type or compare character by character.
- Layout: situations index first, then procedures in order of urgency; a sticky thumb index on desktop, an inline list on phones.
- Thumb-index tab (ink block with P-code and a word for urgency): the identity motif; it carries information (procedure number and urgency), it is not a stripe.
- Ink rule (2px) above each h1 and procedure: the manual's section mark, repeated on every page.
- Radii 2 to 4px: printed forms, not app cards. No shadows except popovers (elevation only).
- Icons: lucide only where they mark status (word + colour + icon) or an action's kind; none decorative.
- Motion: hover and focus only (MOTION 1).
- Evidence: only docs/gate.md facts (mainnet 8 of 8, devnet 28 of 28, mainnet withdraw with the main key alone failed with LockupInForce, linked to its transaction) and the CLI version from core.

## Delivery Gate (antislop, mode: during)

Block 1, Hard Gate (all "no"):
- R-02 PASS: no em dash in v12 files; the 6 em dashes of the shared en.json (rescue strings) replaced in variants/v12/i18n/en.json.
- R-03 PASS: scrollWidth 360 at 360 px on /, /app, /learn, /rescue; commands bleed to full width on phones; targets in the situations index are min-h-11.
- R-17/R-36/R-38 PASS: only gate.md facts (mainnet 8 of 8, devnet 28 of 28, LockupInForce tx link), CLI version and placeholders from core; no counts, no testimonials.
- R-18 PASS: no testimonials. R-23 PASS: no new logo or images (existing favicon kept). R-24 PASS: nav unchanged.
- R-25 PASS: contrast-check.py, see below. R-26 PASS: every new link has a real target (#p1 to #p7, #before-cli, /rescue, /app, /protect, /learn/*, explorer, GitHub).
- R-27 PASS: data views reuse the base empty/loading/error states (SummaryBar, AccountRow skeleton and error unchanged); the procedure line only renders for statuses that exist.
- R-28 PASS: no new FAQ. R-32 PASS: global :focus-visible kept; the caution plate link uses an ink outline in both themes; Tab reached the index and Enter jumped to #p4.
- R-33 PASS: written in overlay source; en.json copy edited as data. R-34 PASS: light and dark shot on all 13 routes, no console errors. R-35 PASS: built and clicked (below). R-37 PASS: direction above.

Block 2, Purpose-Gate: no gradients or glow; lucide icons only for status/urgency and action kind; mono only for commands, addresses, P-codes; no background pattern; no arrows; badges are real statuses; no glass; shadows only on popovers; no feature cards; no motion beyond hover. PASS.

Block 3, Liveliness: dials ENERGY 1 / RHYTHM 2 / MOTION 1 declared; focal point per screen (h1 + situations index; on /app the summary headline); one accent (caution plate); identity motif (ink P-code tab + 2px ink rule) repeated on landing, /app rows and every PageHeader. PASS.

Block 4, Craft and Quality Locks: no template hero/3 cards/3 steps (procedures are seven, as the product has them); CTAs "Check my stake", "Protect my stake", "Open Rescue"; no buzzwords; palette ink + paper + caution + status tones; not a clone. PASS.

Click-through (Playwright, 360 px): index P1..P7 -> each section scrolls to top 16 px; "Before you run a command" -> #before-cli; 11 copy buttons present (base CommandBlock); /app row "P2 The lock ends soon" -> /#p2 lands on P2; "Check my stake" -> /app. Shoot: 26 of 26 routes light, 26 of 26 dark, no console errors.

Contrast (contrast-check.py): light ink/paper 15.31, muted/paper 7.40, muted/surface 8.08, muted/subtle 6.61, on-primary/primary 16.29, ink/caution 10.38, border-strong/surface 4.42 (non-text, needs 3), warning 6.25, danger 5.70, info 6.66, neutral 8.23 on paper; dark foreground 15.26, muted 8.17 / 7.59 / 6.35 (bg, surface, subtle), on-primary 15.26, ink/caution 9.63, border-strong 4.53, warning 12.84, danger 9.76, info 11.11, neutral 11.26.
