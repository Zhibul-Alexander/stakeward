# v15 "Plain utility"

Audience: the non-developer who holds a large stake and is afraid of losing it, and the second-key holder who got a link with no context.
Tone: a public service. Plain words, one task per page, large readable type, nothing to decode.
The one memorable thing: the yellow-and-black focus and the black masthead with the network banner under it; every link you tab to lights up like a road sign.
Left out on purpose: illustrations, cards for their own sake, gradients, shadows (except the button's bottom edge), icons that do not mark a status, marketing tone.

Design Read: start page and accounts page for cautious non-technical holders, in a public-service plain style, dial ENERGY 1 / RHYTHM 1 / MOTION 1.

## Decisions (R-31, one line each)

- Colour: white page, near-black text, one blue for "you can act here" (buttons and links), status colours only for status, yellow only for focus.
- Type: Atkinson Hyperlegible, drawn by the Braille Institute for low-vision readers (distinct I/l/1, 0/O), which suits people reading amounts and addresses with care.
- Mono: IBM Plex Mono for addresses and commands only; its zero and O differ, which matters when someone compares an address character by character.
- Scale: 19 px body on desktop, 16 px on phones, h1 up to 48 px; fluid with clamp() so sizes step down smoothly.
- Layout: a two-thirds reading column with a one-third "if something is wrong now" aside, the start-page pattern; one column on phones.
- Radius: 0 to 4 px, square-ish on purpose: these are forms and records, not toys.
- Shadow: only the 2 px bottom edge of buttons, so a button reads as pressable without colour alone.
- Cards: none on the landing. /app keeps its bordered lists because each row is a record.
- Icons: lucide, only in status badges and where an icon carries meaning (warning "!", external link).
- Motion: hover colour changes only. Nothing loops.
- Focus: 3 px yellow band plus a dark outer line (light) or the reverse (dark), so it passes 3:1 on any background.

## Contrast (antislop-human contrast-check.py)

Light: text #101418 on #ffffff 18.50; muted #4d5560 on #ffffff 7.54, on #f3f2f1 6.75; primary #1b4f8a on #ffffff 8.29 (white on it 8.29); masthead white on #101418 18.50; focus #101418 on yellow #ffdd00 13.74; success #00703c on soft 5.16, on white 6.21; warning #8a4b00 on soft 6.09, on white 6.80; neutral 8.19; info #005a68 on soft 6.77, on white 7.89; danger #b0201a on soft 5.64, on white 6.85; white on danger 6.85; input/checkbox edge #5b636c on white 6.09.
Dark: text #f2f2f0 on #121417 16.46; muted #b6bcc3 on bg 9.64, on subtle 7.53; primary #9cc2f2 on bg 10.03, on surface 9.19, on subtle 7.84; on-primary 9.05; success 8.67; warning 9.39; neutral 8.92; info 8.67; danger 8.08; status text on surface 8.39 to 10.12; focus yellow on bg 13.70.
Decorative row dividers #c4c7ca (1.70 on white) mark no state and are not component edges; inputs use a 2 px text-coloured edge.

## Delivery Gate (antislop core)

Block 1, Hard Gate (all must be "no"):
- R-02 em dash: PASS, grep of v15 sources and copy finds none.
- R-03 mobile: PASS, scrollWidth - clientWidth = 0 on 12 routes at 360 px; masthead fits two rows at 360 (fixed from three); tap targets min 40 to 44 px.
- R-17 / R-36 / R-38 numbers and claims: PASS, only real facts: SwissBorg 8 Sep 2025 192,600 SOL, Step Finance 31 Jan 2026 261,854 SOL, mainnet gate 8 of 8 on 5 Oct 2026 (linked to docs/gate.md), fee about 0.000005 SOL per signature. Live numbers only from /api/stats and /api/health as before.
- R-18 testimonials: PASS, none.
- R-23 assets: PASS, no logo drawn (name as text), no images; the "!" circle is CSS.
- R-24 nav: PASS, every link goes to an existing route (/rescue, /demo, /challenge on devnet, /app, /learn/*, /stats, #cannot-do, #for-second-key, GitHub).
- R-25 contrast: PASS, numbers above; axe (wcag2a/2aa/21aa) 0 violations on 12 routes x 2 widths x 2 themes.
- R-26 dead controls: PASS, no new controls without behaviour; all buttons and links keep their original handlers.
- R-27 states: PASS, /app loading (skeleton with "Reading stake accounts"), empty (no stake accounts, explained), error (ErrorState with Try again) kept; SummaryBar keeps monitoring in every state.
- R-28 FAQ: PASS, unchanged product FAQ on /learn.
- R-32 keyboard: PASS, recorded tab order on /: Skip to content > Stakeward > Rescue > Demo > Try to steal it > Your accounts > Go to mainnet > Check my stake > Protect my stake > Rescue your stake > Read this first > demo > mainnet > FAQ; Enter on FAQ opens /learn/faq. Focus is yellow plus a dark edge everywhere; no outline removed without replacement.
- R-33 patch scripts: PASS, no script left in the repo; files edited as source.
- R-34 themes: PASS, light and dark shot on every route (variants-shots/v15, v15-dark), no broken pages.
- R-35 run and click-through: PASS, built, shot 13 routes x 2 widths x 2 themes, 0 console errors; keyboard walk recorded above; "Check my stake" > /app, "Protect my stake" > /protect, "Read this first" > #for-second-key, "Rescue your stake" > /rescue, footer links > GitHub (new tab), /#cannot-do, /learn/faq, /stats.
- R-37 direction: PASS, direction from the brief, written at the top of this file.

Block 2, Purpose-Gate: no gradients, glow, glass, grids or decorative badges. Icons: lucide only in status badges (word + colour + icon is a product rule), the start button's chevron (start-page convention, the only arrow on the page), external-link and copy icons that carry function; the "Ask your AI" sparkle was replaced by a question bubble. Typeface reason written above. No uppercase tracked labels. Shadow only as the button's bottom edge. PASS.

Block 3, Liveliness: dials ENERGY 1 / RHYTHM 1 / MOTION 1, declared and held (uniform reading column on purpose, hover colour only). Focal point: the start button on /, the answer sentence on /app. Accent: the yellow focus and the single blue action colour. Motif: black masthead, yellow road-sign focus, the "!" warning text. PASS.

Block 4, Craftsmanship: no hero + three cards; the "how it works" steps became the start page's "Use this service to" list and an action table. CTAs are specific ("Check my stake", "Protect my stake", "Rescue your stake"). Palette: one blue, status colours, yellow focus only. Not a clone: GOV.UK is the named reference in the brief; the palette, type and components are Stakeward's own. PASS.

Fixed during the gate: masthead took three rows at 360 px (now two); sparkle icon on "Ask your AI".
Known trade-off: Atkinson Hyperlegible draws a slashed zero, so amounts read "32Ø SOL"; it is deliberate in the font (no 0/O confusion) but may look unusual to some readers.
