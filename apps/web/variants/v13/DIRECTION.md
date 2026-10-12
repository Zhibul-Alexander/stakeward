# v13 "Tbilisi"

Audience: Colosseum judges on the Superteam Georgia track, the Georgian crypto community, and the cautious holder of a large native stake. Tone: warm, calm, plain-spoken; a workshop that handles money, not a tourist poster.
The one memorable thing: a carved wooden balcony (old Tbilisi, Sololaki and Kala) drawn in SVG, used once, as the frame around the hero's statement of the lock rule: what the main key alone can and cannot do.
Deliberately left out: Georgian script, flags, churches, wine and mountains; gradients, glows, grids, eyebrow pills, icon tiles, feature-card rows, testimonials, invented numbers.

Design Read: landing + account dashboard for stake holders and hackathon judges, in a "carved wood on bath-house stone" language, dial ENERGY 2 / RHYTHM 3 / MOTION 1.

## Decisions (R-31, one line each)

- Background, sulphur-bath stone (#E5E3DD light, grey not cream): the Abanotubani stone, calm and neutral so status colours carry meaning.
- Primary, dark walnut (#4B3122): balcony wood; the one action of a screen looks like the carved door, not a SaaS button.
- Accent, old-town brick (#8C3A22): used only in the balcony signature and the focus ring, so it marks "this is the lock" and "you are here".
- Protected = Kura river green (#2A5A4C); Expiring = ochre; danger = a deeper red than brick; info = slate river blue. Colour still means state (word + colour + icon kept).
- Dark theme: the same city at night: warm dark wood surfaces, lit wood primary; both themes follow the system setting, as before.
- Display type, Bricolage Grotesque: its slightly hand-cut, ink-trapped shapes read like painted Tbilisi shop signs, without the cream-serif default.
- Body type, Atkinson Hyperlegible: designed for low vision, it tells l/1/I and 0/O apart, which matters on a screen full of addresses and amounts.
- Mono, IBM Plex Mono: addresses and signatures only; its slashed zero and open forms keep base58 readable.
- Radii small (2 to 8 px): carved, cut edges; status badges become squared tags instead of pills.
- Layout: the landing is a sequence with changing compositions (split hero with the balcony, a dated record of two thefts, a ledger of who can do what, the honest limit as a full band, the mechanism checks with their recorded results, a two-column "cannot do" list, the co-sign note, the closing look). Each section has its own shape because its content does.
- Icons (lucide, project rule): only for status and roles, where they carry meaning.
- Motion: hover and focus only (MOTION 1); no entrance animations.

## Delivery Gate (antislop, mode: during, session override)

Block 1, Hard Gate (all "no" required)
- R-02 PASS: no em dash in any v13 file; the 6 inherited from src/i18n/en.json (rescue status strings) replaced with colons or full stops in the v13 copy.
- R-03 PASS: all 13 routes shot at 360 px in light and dark; every mobile PNG is exactly 360 px wide (no horizontal scroll); scripted check reports scrollWidth overflow 0 at 1280 and 360.
- R-17 PASS: the only numbers are real: SwissBorg 192,600 SOL (8 Sep 2025) and Step Finance 261,854 SOL (31 Jan 2026) from CLAUDE.md section 1; gate runs 31/31, 28/28, 8/8 from docs/gate.md, linked; /app and /stats render API data only.
- R-18 PASS: no testimonials.
- R-23 PASS: no new logo; the indigo favicon mark is dropped from the header and the name is set as a text wordmark. The balcony drawing was pre-approved (inline SVG, brief R-23).
- R-24 PASS: nav and footer destinations unchanged; every internal link opened in the click-through landed on a page with an h1.
- R-25 PASS: contrast numbers below.
- R-26 PASS: every control has a real href or handler (unchanged logic); no dead controls added.
- R-27 PASS: empty, loading and error states come from the shared components, restyled by tokens (app-empty, extend clock error, cosign incomplete link all checked in shots).
- R-28 PASS: FAQ unchanged (product-specific, from en.json).
- R-32 PASS: Tab order follows visual order (skip link, wordmark, nav, hero CTAs, demo, section links, learn links, footer); every stop shows a 2 px brick outline.
- R-33 PASS: no patch scripts; every change is a file in variants/v13.
- R-34 PASS: light and dark both shot on all routes; dark tokens checked.
- R-35 PASS: built with vite and shot 26 + 26 screens with no console errors. Click-through (scripted, 1280 and 360): Check my stake -> /app "Your stake accounts"; Protect my stake -> /protect; Demo -> /demo; Rescue -> /rescue; Try to steal it -> /challenge; FAQ/Alerts/Costs/Wallets/Safety -> /learn/*; What makes a good second key -> /learn/faq#faq-good-second-key; co-sign link -> /learn/faq#faq-co-sign; footer cannot-do -> /#cannot-do; Stats -> /stats; Read the results -> GitHub docs/gate.md (new tab, named so).
- R-36 PASS: no compliance or performance claims; "Checked on the real stake program" points at the recorded runs.
- R-37 PASS: direction written above (concept from the brief).
- R-38 PASS: no fabricated content; Step Finance is given only date and amount because the brief states no mechanism.

Block 2, Purpose-Gate
- R-01 PASS: no gradients or glows. R-04 PASS: lucide only for status, roles (key icons in the balcony), warnings and external links. R-06 PASS: typefaces chosen for reasons above; no uppercase tracked labels; mono only for addresses. R-07 PASS: no background pattern; the lattice exists once, in the hero. R-08 PASS: no arrows on buttons. R-09 PASS: badges only for network and status. R-10/R-12/R-13 PASS: no glass, no new shadows, no glow. R-14 PASS: no feature-card row; sections differ by content. R-19 PASS: no motion beyond hover and focus. R-22 PASS: the balcony is tied to the brief (Tbilisi, Superteam Georgia) and frames the lock rule.

Block 3, Liveliness: dials declared (ENERGY 2 / RHYTHM 3 / MOTION 1) and held; one focal point per screen (hero headline with the balcony; /app the protected-SOL headline); one accent (brick, balcony and focus only); identity motif: the heavy 2 px rule over sequences plus the display face on every h1/h2 and amount; Design Read declared above. All yes.

Block 4, Craftsmanship: no template layout (incidents, ledger, dark limit band, evidence table, ruled list each have their own form); radii small and varied; CTAs specific ("Check my stake", "Protect my stake"); no buzzwords; palette stone + walnut + river green + brick accent; not a clone. All no.

Result: PASS.

## Contrast (contrast-check.py, WCAG 2.x)

Light: foreground on background 13.35, on surface 15.43, on subtle 11.80; muted on background 6.66, on surface 7.70, on subtle 5.89; on-primary on walnut 10.69; walnut on background 9.29; focus ring (brick) on background 5.96; border-strong on surface 4.56; success 5.88, warning 5.51, neutral 6.81, info 6.22, danger 5.92 on their soft fills; white on danger-solid 7.94.
Dark: foreground on background 15.05, on surface 13.84, on subtle 11.39; muted on background 8.40, on surface 7.73, on subtle 6.36; on-primary on lit wood 9.88; ring on background 7.56; border-strong on surface 4.44 (non-text, 3:1 required); success 7.73, warning 8.60, neutral 8.66, info 8.21, danger 8.01 on their soft fills; white on danger-solid 6.69.

## Known gaps

- Desktop header nav buttons stay 32 px tall (pointer use); from 0 to 639 px they are 44 px.
- Account rows, wizards and signing screens keep their base layout; they take the v13 tokens, type and squared badges but were not recomposed.
