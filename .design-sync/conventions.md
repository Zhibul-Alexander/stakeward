## Building with Stakeward

Stakeward protects natively staked SOL with the stake program's own lock. Screens are calm and plain: the answer first,
details after, one main action per screen.

**Setup.** `styles.css` styles `body` itself (background, text colour, Geist), so components need no theme provider.
Light and dark themes follow `prefers-color-scheme`. Only `Tooltip` needs a wrapper: put `TooltipProvider` around it.
Icons the product uses are on the global too: `const { ShieldCheckIcon, CalendarPlusIcon } = window.Stakeward;`. Give
them `aria-hidden="true"` inside a labelled button.

**Styling: Tailwind utility classes on design tokens.** Never raw colours, pixel values or `[arbitrary]` classes.
- Colour (as `bg-*`, `text-*`, `border-*`): `background` (page), `surface` (panels), `surface-raised`, `subtle` (muted
  fills), `foreground`, `muted` (secondary text), `border`, `border-strong`, `primary` + `on-primary` (the one action),
  `primary-soft` (selection). Status tones `success`, `warning`, `danger`, `info`, `neutral`, each with `-soft` (fill)
  and `-border`.
- Type: six sizes only: `text-xs` (meta), `text-sm` (UI text), `text-base` (prose), `text-lg` (section titles),
  `text-2xl` (h1 on phones, key numbers), `text-3xl` (h1 from `sm:`). Weights `font-normal`, `font-medium`,
  `font-semibold`. `tabular-nums` on amounts; `font-mono` only for addresses and commands.
- Layout: `flex`, `grid`, `grid-cols-1..6`, `gap-*`, `p-*`/`m-*` (0-24), `max-w-xs..7xl`, `rounded-md`/`rounded-lg`,
  `divide-y divide-border`, with `sm:`/`md:`/`lg:` variants. Only these families are compiled; others render nothing.
- Panels are `rounded-lg border border-border bg-surface p-4`.

**Product rules a design must keep.** At most one filled button (`variant="primary"` or `"danger"`) per screen; every
other action is `outline`, `ghost` or `link`. A status is word + colour + icon (use `StatusBadge`). Keys are called
"Main key", "Second key" and "New wallet", never custodian or withdrawer. A signing screen shows `TransactionSummary`,
the risk with its date right above the Sign button (`ActionBar` + `RiskNote`), and "Stakeward never asks for your seed
phrase". SOL amounts go through `SolAmount`, addresses through `AddressText` (copy + explorer). Errors use `ErrorState`
with a way forward.

**Where the truth is.** `styles.css` and its import `_ds_bundle.css` (token values: `--color-*`, `--text-*`,
`--radius-*`). Each component's `components/<group>/<Name>/<Name>.prompt.md` has real examples; `<Name>.d.ts` lists the
DS's own props. Primitives (`Button`, `Input`, `Checkbox`, `Label`, ...) also forward every native attribute of their
element (`onClick`, `disabled`, `type`, `value`, `aria-*`); `Button asChild` wraps an `<a>`.

**Page skeleton.**

```jsx
const { Page, PageHeader, Section, Button, StatusBadge, SolAmount, ShieldCheckIcon } = window.Stakeward;

<Page width="app">
  <PageHeader title="Your stake accounts" lead="Paste any wallet address to see its stake. Looking and connecting sign nothing." />
  <Section
    title="Needs attention"
    count="1 · 3.2 SOL"
    description="Without a lock, or once it ends, anyone with your main key can withdraw the stake."
    action={<Button size="sm"><ShieldCheckIcon aria-hidden="true" />Protect 1 account</Button>}
  >
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
      <StatusBadge status="unprotected" />
      <SolAmount lamports={3_200_000_000n} className="font-semibold tabular-nums" />
    </div>
  </Section>
</Page>
```

Lists of stake accounts use `AccountList` > `AccountListItem` > `AccountRow` (see its prompt for the data shape).
