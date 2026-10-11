import type { Address } from "@solana/kit";
import {
  formatSol,
  shortAddress,
  type ActivationStatus,
  type ClockView,
} from "@stakeward/core";
import {
  ArrowDownToLineIcon,
  BellIcon,
  ClockIcon,
  LayersIcon,
  CalendarPlusIcon,
  CirclePauseIcon,
  FileTextIcon,
  KeyRoundIcon,
  LifeBuoyIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SendIcon,
  Share2Icon,
  ShieldCheckIcon,
  ShieldXIcon,
  SproutIcon,
  VenetianMaskIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Section } from "@/components/layout/Section";
import {
  AccountList,
  AccountListItem,
  AccountListSkeleton,
  AccountRow,
} from "@/components/product/account-row";
import { AddressText } from "@/components/product/address-text";
import { NoStakeAccounts } from "@/components/product/empty-state";
import { ErrorState } from "@/components/product/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Health } from "@/api/health";
import { telegramLinkPath } from "@/api/telegram";
import { t } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import {
  useKnownSecondKeys,
  usePorts,
  useProtectedAccounts,
  useSlot,
  useWalletSlots,
} from "@/ports";
import { useHealth, useNow, useStakeAccounts } from "./hooks.ts";
import { KeySlot } from "./KeySlot.tsx";
import { MonitoringStatus } from "./MonitoringStatus.tsx";
import { ProtectionCheckSection } from "./ProtectionCheckSection.tsx";
import {
  appLinks,
  attentionNote,
  buildAccountsView,
  protectableInGroup,
  stakeKeyChanged,
  type AccountView,
  type AccountsView,
  type PrimaryAction,
} from "./view.ts";

/** "Last checked N min ago" moves on while the page is open. */
const CLOCK_TICK_MS = 30_000;

/** A SOL amount without its unit, for sentences that say "SOL" once: "1,293.25 of 1,490.45 SOL protected". */
const solNumber = (lamports: bigint) =>
  formatSol(lamports).replace(/ SOL$/, "");

const sumOf = (rows: readonly AccountView[]) =>
  rows.reduce((total, row) => total + row.account.lamports, 0n);

/**
 * The stake of one main key: first the answer (how much is protected, how fresh that is), then the accounts grouped by
 * what they ask of the viewer, then the accounts whose lock it holds as second key (DECISIONS.md D112). Everything
 * comes from the chain on each read (CLAUDE.md section 5: reload-safe); the device adds only the known second keys and
 * the accounts it saw protected.
 */
export function AccountsResults({
  address,
  loadHealth,
}: {
  address: Address;
  loadHealth: () => Promise<Health>;
}) {
  const { chain, protectedAccounts, api } = usePorts();
  const knownSecondKeys = useKnownSecondKeys();
  const rememberedProtected = useProtectedAccounts();
  const mainSlot = useWalletSlots().main;
  const [attempt, setAttempt] = useState(0);
  const state = useStakeAccounts(chain, address, attempt);
  const health = useHealth(loadHealth, attempt);
  const now = useNow(CLOCK_TICK_MS);
  const reload = () => {
    setAttempt((value) => value + 1);
  };

  const view = useMemo(
    () =>
      state.status === "ready"
        ? buildAccountsView({
            address,
            accounts: state.data.accounts,
            clock: state.data.clock,
            knownSecondKeys,
            rememberedProtected,
          })
        : null,
    [address, state, knownSecondKeys, rememberedProtected],
  );

  // F6: remember what this device saw protected, so a lock that ends later shows the red banner. Only for the main
  // key connected here: anyone can lock their own accounts to a second key (it is public), so viewing a stranger's
  // address must not write the memory, or a link with enough such accounts would push the viewer's own out of it.
  const confirmed =
    mainSlot?.address === address ? view?.confirmedProtected : undefined;
  useEffect(() => {
    if (confirmed !== undefined && confirmed.length > 0)
      protectedAccounts.remember(confirmed);
  }, [confirmed, protectedAccounts]);

  // The same locks go under monitoring, each once per page (DECISIONS D50): a lock made elsewhere, or one whose
  // POST /api/watch failed on the Done screen, is watched from here on. The worker reads the chain itself and accepts
  // only a lock in force, so this sends nothing but public addresses; a failure is silent (the page works without it).
  // Never for a view by address.
  const postedRef = useRef(new Set<Address>());
  useEffect(() => {
    if (confirmed === undefined) return;
    const posted = postedRef.current;
    const newOnes = confirmed.filter((account) => !posted.has(account));
    if (newOnes.length === 0) return;
    for (const account of newOnes) posted.add(account);
    void api.watch(newOnes).catch(() => undefined);
  }, [confirmed, api]);

  // What a check found, for screen readers (UX rule 11): the loading line that announced the read is gone by then. The
  // region stays in the page so that the change of its text is what gets announced.
  const found =
    view === null ? 0 : view.owned.length + view.secondKeyFor.length;
  const announcement =
    view === null
      ? ""
      : found === 0
        ? t("app.results.announceNone")
        : found === 1
          ? t("app.results.announceOne")
          : t("app.results.announceOther", { count: found });

  return (
    <div data-slot="accounts-results" className="flex flex-col gap-6 sm:gap-8">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {/* "Last checked" and Refresh in every state, the read error included: they matter most when the worker or the
          RPC may be down (UX rule 12). Alerts reach a second-key holder too; only an address with nothing to watch
          has no Telegram, and nothing to sum up: there the line stands without a card above the empty state. */}
      {view !== null && found === 0 ? (
        <section
          aria-label={t("app.summary.label")}
          data-slot="summary-line"
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <MonitoringStatus state={health} now={now} />
          <RefreshButton onRefresh={reload} />
        </section>
      ) : (
        <Summary
          address={address}
          view={view}
          state={state.status}
          monitoring={<MonitoringStatus state={health} now={now} />}
          onRefresh={reload}
        />
      )}
      {state.status === "loading" ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted"
          >
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-4 animate-spin"
            />
            {t("app.results.loading")}
          </p>
          <AccountListSkeleton rows={3} />
        </div>
      ) : state.status === "error" ? (
        <ErrorState
          title={t("app.results.errorTitle")}
          message={errorMessage(state.error)}
          detail={state.error.detail}
          onRetry={reload}
        />
      ) : view === null ? null : (
        <Loaded address={address} view={view} clock={state.data.clock} />
      )}
    </div>
  );
}

/** Share of the owned SOL under the viewer's own lock, 0 to 100 with one decimal. */
function percentOf(part: bigint, total: bigint): number {
  if (total === 0n) return 0;
  return Number((part * 1000n) / total) / 10;
}

/**
 * The protection ring: the share of SOL under the viewer's own lock (accent), then the share locked by a second key
 * this browser does not know yet (info, a second segment). Sizes and arc lengths are SVG attributes (pathLength 100),
 * not inline styles, so the page keeps its strict CSP.
 */
function ProtectionRing({ percent, unconfirmed }: { percent: number; unconfirmed: number }) {
  const tone = percent >= 99.95 ? 'text-success' : 'text-primary';
  const arc = (length: number, offset: number, className: string) => (
    <circle
      cx="60"
      cy="60"
      r="52"
      fill="none"
      strokeWidth="10"
      pathLength={100}
      strokeDasharray={`${String(Math.max(length - 1, 0.5))} 100`}
      strokeDashoffset={-offset}
      className={className}
    />
  );
  return (
    <div className="relative grid size-36 shrink-0 place-items-center">
      <svg viewBox="0 0 120 120" aria-hidden="true" className="absolute inset-0 size-full -rotate-90">
        <circle cx="60" cy="60" r="52" fill="none" strokeWidth="10" className="stroke-subtle" />
        {unconfirmed > 0 ? arc(unconfirmed, percent, 'stroke-current text-info-border') : null}
        {percent > 0 ? arc(percent, 0, `stroke-current ${tone}`) : null}
      </svg>
      <div className="relative flex flex-col items-center">
        <span className="font-display text-3xl font-semibold tabular-nums">{`${String(Math.round(percent))}%`}</span>
        <span className="text-xs text-muted">protected</span>
      </div>
    </div>
  );
}

/** The ring's key: a swatch and a word for each segment (colour is never the only cue). */
function RingLegend({ items }: { items: readonly { swatch: string; label: string }[] }) {
  return (
    <ul role="list" className="flex flex-col gap-1 text-left text-xs text-muted tabular-nums">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-2">
          <span aria-hidden="true" className={`mt-1 size-2 shrink-0 rounded-sm ${item.swatch}`} />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** One KPI tile of the dashboard: a short label, the number, one muted line. */
function Kpi({
  label,
  value,
  note,
  icon,
  tone = 'default',
  children,
  className,
}: {
  className?: string;
  label: string;
  value?: ReactNode;
  note?: ReactNode;
  icon: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'neutral';
  children?: ReactNode;
}) {
  const iconTone =
    tone === 'success'
      ? 'bg-success-soft text-success'
      : tone === 'warning'
        ? 'bg-warning-soft text-warning'
        : tone === 'neutral'
          ? 'bg-neutral-soft text-neutral'
          : 'bg-primary-soft text-primary';
  return (
    <div data-slot="kpi" className={`flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:p-4 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span aria-hidden="true" className={`grid size-7 place-items-center rounded-md [&>svg]:size-4 ${iconTone}`}>
          {icon}
        </span>
      </div>
      {value === undefined ? null : <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>}
      {note === undefined ? null : <div className="text-xs text-muted tabular-nums">{note}</div>}
      {children}
    </div>
  );
}

function Summary({
  address,
  view,
  state,
  monitoring,
  onRefresh,
}: {
  address: Address;
  view: AccountsView | null;
  state: "loading" | "error" | "ready";
  monitoring: ReactNode;
  onRefresh: () => void;
}) {
  const owned = view === null ? 0 : view.owned.length;
  const secondKeyFor = view === null ? 0 : view.secondKeyFor.length;
  const protectedCount = view === null ? 0 : view.confirmedProtected.length;
  const expiring = view === null ? 0 : view.owned.filter((row) => row.protection === "expiring").length;
  const open = view === null ? 0 : view.owned.filter((row) => row.protection === "unprotected").length;
  const percent = view === null ? 0 : percentOf(view.totals.protectedLamports, view.totals.lamports);
  const unconfirmedPercent = view === null ? 0 : percentOf(view.lockedUnconfirmedLamports, view.totals.lamports);
  const headline =
    view === null || owned === 0
      ? undefined
      : t("app.summary.headline", {
          protected: solNumber(view.totals.protectedLamports),
          total: solNumber(view.totals.lamports),
        });
  const accountsLine =
    owned === 1
      ? t("app.summary.accountsOne", { protected: protectedCount })
      : t("app.summary.accounts", { protected: protectedCount, count: owned });
  const secondKeyLine =
    secondKeyFor === 1
      ? t("app.summary.secondKeyForOne")
      : t("app.summary.secondKeyForOther", { count: secondKeyFor });

  const tools = (
    <div data-slot="summary-tools" className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <a
          href={telegramLinkPath(address)}
          target="_blank"
          rel="noreferrer"
          aria-label={`${t("app.results.telegram")} ${t("common.opensInNewTab")}`}
        >
          <SendIcon aria-hidden="true" />
          {t("app.results.telegram")}
        </a>
      </Button>
      <RefreshButton onRefresh={onRefresh} />
    </div>
  );

  return (
    <section
      aria-label={t("app.summary.label")}
      data-slot="summary-bar"
      data-state={state}
      className="flex flex-col gap-4"
    >
      {state === "loading" ? (
        <div aria-hidden="true" className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <Skeleton className="h-52 rounded-lg" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        </div>
      ) : state === "ready" && view !== null && owned > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          {/* The answer: the ring and the sentence it stands for. */}
          <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-5 text-center sm:flex-row sm:text-left lg:flex-col lg:text-center">
            <ProtectionRing percent={percent} unconfirmed={unconfirmedPercent} />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="font-display text-lg font-semibold text-balance tabular-nums">{headline}</p>
              <RingLegend
                items={[
                  { swatch: percent >= 99.95 ? 'bg-success' : 'bg-primary', label: accountsLine },
                  ...(view.lockedUnconfirmedLamports === 0n
                    ? []
                    : [{ swatch: 'bg-info-border', label: t("app.summary.unconfirmed", { amount: solNumber(view.lockedUnconfirmedLamports) }) }]),
                  ...(open > 0 ? [{ swatch: 'bg-subtle-hover', label: `${String(open)} ${t("status.unprotected").toLowerCase()}` }] : []),
                  ...(secondKeyFor > 0 ? [{ swatch: 'bg-border-strong', label: secondKeyLine }] : []),
                ]}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Kpi
              label="SOL protected"
              icon={<ShieldCheckIcon />}
              tone={percent >= 99.95 ? "success" : "default"}
              value={solNumber(view.totals.protectedLamports)}
              note={`of ${formatSol(view.totals.lamports)}`}
            />
            <Kpi
              label="Stake accounts"
              icon={<LayersIcon />}
              tone={open > 0 ? "neutral" : "success"}
              value={
                <>
                  {protectedCount}
                  <span className="text-base font-medium text-muted">{` / ${String(owned)}`}</span>
                </>
              }
              note={open === 0 ? t("status.protected") : `${String(open)} ${t("status.unprotected").toLowerCase()}`}
            />
            <Kpi
              label={t("status.expiring")}
              icon={<ClockIcon />}
              tone={expiring > 0 ? "warning" : "success"}
              value={expiring}
              note="Locks that end within 30 days"
            />
            <Kpi label="Alerts" icon={<BellIcon />} tone="default" className="col-span-2 sm:col-span-1">
              <div className="flex flex-col gap-2">
                {monitoring}
                {tools}
              </div>
            </Kpi>
          </div>
        </div>
      ) : (
        // An error, or an address that is only someone's second key: the monitor and the tools on one strip.
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            {state === "ready" && secondKeyFor > 0 ? <p className="font-display text-lg font-semibold">{secondKeyLine}</p> : null}
            {monitoring}
          </div>
          {tools}
        </div>
      )}
      {owned === 0 ? null : (
        // Rescue for any stake of this main key (D70), and the public proof page (D124): the console's quick actions.
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-subtle px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            <LifeBuoyIcon aria-hidden="true" className="mr-1.5 inline size-4 align-text-bottom text-danger" />
            {t("app.results.rescueNote")}{" "}
            <Link
              href={appLinks.rescue(address)}
              className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
            >
              {t("app.results.rescue")}
            </Link>
          </p>
          <Link
            href={appLinks.proof(address)}
            className="inline-flex w-fit items-center gap-1 rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            <Share2Icon aria-hidden="true" className="size-4" />
            {t("app.results.shareProof")}
          </Link>
        </div>
      )}
    </section>
  );
}

function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={t("app.results.refresh")}
      onClick={onRefresh}
    >
      <RefreshCwIcon aria-hidden="true" />
    </Button>
  );
}

function Loaded({
  address,
  view,
  clock,
}: {
  address: Address;
  view: AccountsView;
  clock: ClockView;
}) {
  const {
    attention,
    protected: protectedRows,
    locked,
    secondKeyFor,
  } = view.groups;
  const primary = view.primaryAction;
  // The second key as this browser can use it now: a slot remembered from before whose wallet does not offer it (not
  // reconnected yet, or gone) would draw an empty slot, that is a Connect button.
  const secondReady = useSlot("second")?.ready === true;
  if (view.owned.length === 0 && secondKeyFor.length === 0)
    return <NoStakeAccounts address={address} />;

  const secondKeyForSection =
    secondKeyFor.length === 0 ? null : (
      <Section
        title={t("app.groups.secondKeyFor")}
        count={groupCount(secondKeyFor)}
        description={t("app.groups.secondKeyForNote")}
      >
        <Rows
          label={t("app.groups.secondKeyFor")}
          rows={secondKeyFor}
          clock={clock}
          actions={(row) => secondKeyActions(row, primary)}
          meta={(row) => <MainKeyMeta mainKey={row.account.withdrawer} />}
        />
      </Section>
    );

  // An address that is only someone's second key: their list first, and one line for the empty main list.
  if (view.owned.length === 0) {
    return (
      <>
        {secondKeyForSection}
        <p className="text-sm text-muted">{t("app.lists.noneOwned")}</p>
      </>
    );
  }

  const protectable = protectableInGroup(attention);
  // The groups' kind follows what this browser knows (D102): all locks of unknown keys are of one kind.
  const lockedKnown = locked.some((row) => row.secondKeyKnown);
  return (
    <>
      {view.noLongerProtected.length === 0 ? null : (
        <NoLongerProtectedBanner accounts={view.noLongerProtected} />
      )}
      {attention.length === 0 ? null : (
        <Section
          title={t("app.groups.attention")}
          count={groupCount(attention)}
          // Said once for the group (D112), true of every row it covers.
          description={attentionDescription(attention)}
          action={
            protectable.length === 0 ? undefined : (
              <Button
                asChild
                size="sm"
                variant={
                  primary?.kind === "protect-group" ? "primary" : "outline"
                }
              >
                <Link href={appLinks.protect(protectable)}>
                  <ShieldCheckIcon aria-hidden="true" />
                  {protectable.length === 1
                    ? t("app.actions.protectGroupOne")
                    : t("app.actions.protectGroupOther", {
                        count: protectable.length,
                      })}
                </Link>
              </Button>
            )
          }
        >
          <Rows
            label={t("app.groups.attention")}
            rows={attention}
            clock={clock}
            actions={(row) => attentionActions(row, primary)}
          />
        </Section>
      )}
      {protectedRows.length === 0 ? null : (
        <Section
          title={t("app.groups.protected")}
          count={groupCount(protectedRows)}
          description={t("app.groups.protectedNote")}
        >
          <Rows
            label={t("app.groups.protected")}
            rows={protectedRows}
            clock={clock}
            actions={(row) => lockedActions(row, primary)}
          />
        </Section>
      )}
      {locked.length === 0 ? null : (
        <Section
          title={
            lockedKnown ? t("app.groups.locked") : t("app.groups.lockedUnknown")
          }
          count={groupCount(locked)}
          description={
            lockedKnown
              ? t("status.lockedByAnotherHint")
              : t("status.lockedByOtherHint")
          }
          // With no second key known, "Connect second key": on a new device these are usually the viewer's own locks.
          // With one known, a lock none of them holds may be a fake site's (D35): no "connect it", only a second key
          // connected and ready here, to compare with the holder.
          action={
            lockedKnown && !secondReady ? undefined : (
              <KeySlot
                role="second"
                mainKey={address}
                layout="inline"
                connectLabel={t("app.connect.secondButton")}
              />
            )
          }
        >
          {/* Each row names the key that holds its lock (D35); none has an action (D102). */}
          <Rows
            label={
              lockedKnown
                ? t("app.groups.locked")
                : t("app.groups.lockedUnknown")
            }
            rows={locked}
            clock={clock}
            actions={() => ({})}
          />
        </Section>
      )}
      {/* After the lists it checks (D125): a checklist with a score, then Ask your AI. */}
      <ProtectionCheckSection
        address={address}
        accounts={view.owned.map((row) => row.account)}
        clock={clock}
      />
      {secondKeyForSection}
    </>
  );
}

/** The consequence Needs attention says once: now for rows without a lock, once it ends for locks that end soon. */
function attentionDescription(
  rows: readonly AccountView[],
): string | undefined {
  switch (attentionNote(rows)) {
    case "open":
      return t("status.unprotectedHint");
    case "ending":
      return t("app.groups.attentionEnding");
    case "open-or-ending":
      return t("app.groups.attentionOpenOrEnding");
    case null:
      return undefined;
  }
}

/** "4 · 229.95 SOL": how many accounts a group holds and their SOL. */
function groupCount(rows: readonly AccountView[]): string {
  return t("app.groups.count", {
    count: rows.length,
    amount: formatSol(sumOf(rows)),
  });
}

/** A row's visible action and the ones behind its More. */
type RowActions = { action?: ReactNode; more?: ReactNode };

function Rows({
  label,
  rows,
  clock,
  actions,
  meta,
}: {
  label: string;
  rows: readonly AccountView[];
  /** The clock the statuses were computed with: a lock that ends within 30 days shows its date in warning. */
  clock: ClockView;
  actions: (row: AccountView) => RowActions;
  meta?: ((row: AccountView) => ReactNode) | undefined;
}) {
  // Rescue for the account's own main key (its withdrawer): the address itself in the main lists, the owner in the
  // second-key list. The row links it only under its warning that another key can stop or move the stake. Every list
  // keeps room for an action and More, so the SOL of all groups stands in one column.
  return (
    <AccountList label={label} actionColumns>
      {/* The table's column heads (decorative: each row names its own cells). From 640 px only, where rows are a grid. */}
      <li aria-hidden="true" className="hidden rounded-t-lg bg-subtle px-4 py-2 text-xs font-medium text-muted sm:grid">
        <div className="grid grid-cols-subgrid">
          <span>Status and account</span>
          <span className="ml-3 text-right">Balance</span>
          <span className="ml-3 text-right">Action</span>
          <span />
        </div>
      </li>
      {rows.map((row) => {
        const { action, more } = actions(row);
        return (
          <AccountListItem key={row.account.address}>
            <AccountRow
              account={row.account}
              activation={row.activation}
              clock={clock}
              protection={row.protection}
              managedByService={row.managedByService}
              secondKeyKnown={row.secondKeyKnown}
              wasProtected={row.wasProtected}
              rescueHref={appLinks.rescue(row.account.withdrawer)}
              action={action}
              moreActions={more}
              meta={meta?.(row)}
              hint={false}
              serviceDetail
            />
          </AccountListItem>
        );
      })}
    </AccountList>
  );
}

/** For "You are the second key for": whose stake it is (copy, explorer: UX rule 9). */
function MainKeyMeta({ mainKey }: { mainKey: Address }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span>{t("common.roles.main")}</span>
      <AddressText address={mainKey} />
    </span>
  );
}

function ActionLink({
  href,
  label,
  icon,
  variant,
  account,
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  variant: "primary" | "outline";
  account: Address;
}) {
  return (
    <Button asChild size="sm" variant={variant}>
      <Link
        href={href}
        aria-label={t("app.actions.label", {
          action: label,
          address: shortAddress(account),
        })}
      >
        {icon}
        {label}
      </Link>
    </Button>
  );
}

const isPrimaryExtend = (primary: PrimaryAction, account: Address) =>
  primary?.kind === "extend" && primary.account === account;

function ExtendLink({
  account,
  primary,
}: {
  account: Address;
  primary: PrimaryAction;
}) {
  return (
    <ActionLink
      href={appLinks.extend(account)}
      label={t("app.actions.extend")}
      icon={<CalendarPlusIcon aria-hidden="true" />}
      variant={isPrimaryExtend(primary, account) ? "primary" : "outline"}
      account={account}
    />
  );
}

/**
 * Needs attention. A changed stake key under the viewer's own lock: Rescue, the sign of a stolen main key (SECURITY-CHECK
 * П6), with the lock's own actions behind More. Without a lock: Protect behind More, as the group's "Protect N
 * accounts" covers it; a stake a service may manage is left out of that and keeps its own Protect. Expiring: Extend.
 */
function attentionActions(
  row: AccountView,
  primary: PrimaryAction,
): RowActions {
  const account = row.account.address;
  if (stakeKeyChanged(row)) {
    return {
      action: (
        <ActionLink
          href={appLinks.rescue(row.account.withdrawer)}
          label={t("app.actions.rescue")}
          icon={<LifeBuoyIcon aria-hidden="true" />}
          variant={
            primary?.kind === "rescue" && primary.account === account
              ? "primary"
              : "outline"
          }
          account={account}
        />
      ),
      more: (
        <>
          <ExtendLink account={account} primary={primary} />
          <LockedRest row={row} />
        </>
      ),
    };
  }
  if (row.protection !== "unprotected") return lockedActions(row, primary);
  const protect = (
    <ActionLink
      href={appLinks.protect([account])}
      label={
        row.wasProtected
          ? t("app.actions.protectAgain")
          : t("app.actions.protect")
      }
      icon={<ShieldCheckIcon aria-hidden="true" />}
      variant="outline"
      account={account}
    />
  );
  const steal = <StealLink account={account} />;
  // Without a lock the main key withdraws alone; the row shows the way, the group's button protects.
  return row.managedByService
    ? {
        action: protect,
        more: (
          <>
            <WithdrawLink account={account} activation={row.activation} />
            {steal}
          </>
        ),
      }
    : {
        action: stakeActions(row).action,
        more: (
          <>
            {stakeActions(row).more}
            {protect}
            {steal}
          </>
        ),
      };
}

/**
 * Locked by the viewer's own second key: Withdraw with both keys, with Extend, Change second key and the recovery card
 * behind More; a lock that ends soon shows Extend, and Withdraw goes behind More.
 */
function lockedActions(row: AccountView, primary: PrimaryAction): RowActions {
  const account = row.account.address;
  const extend = <ExtendLink account={account} primary={primary} />;
  if (row.protection === "expiring")
    return {
      action: extend,
      more: <LockedRest row={row} />,
    };
  const stake = stakeActions(row);
  return {
    action: stake.action,
    more: (
      <>
        {stake.more}
        {extend}
        <ChangeKeyLink account={account} />
        <RecoveryCardLink account={account} />
        <StealLink account={account} />
      </>
    ),
  };
}

/**
 * Delegate is offered for an inactive stake whose staking the main key manages (DECISIONS.md D134): such a stake earns
 * nothing. One never delegated shows Delegate with Withdraw behind More; one that stopped staking keeps Withdraw, the
 * likelier reason it stopped, with Delegate behind More.
 */
function stakeActions(row: AccountView): { action: ReactNode; more: ReactNode } {
  const account = row.account.address;
  const withdraw = <WithdrawLink account={account} activation={row.activation} />;
  if (row.activation !== "inactive" || row.managedByService)
    return { action: withdraw, more: null };
  const delegate = <DelegateLink account={account} />;
  return row.account.delegation === null
    ? { action: delegate, more: withdraw }
    : { action: withdraw, more: delegate };
}

/** Behind More on a lock the viewer holds: withdrawing with both keys, a new second key, the recovery card, and the thief's view. */
function LockedRest({ row }: { row: AccountView }) {
  const account = row.account.address;
  const stake = stakeActions(row);
  return (
    <>
      {stake.action}
      {stake.more}
      <ChangeKeyLink account={account} />
      <RecoveryCardLink account={account} />
      <StealLink account={account} />
    </>
  );
}

/**
 * The withdraw page: a stake that still earns stops staking there first (F3.1), so its button says Unstake; once staking
 * stops, the same page withdraws.
 */
function WithdrawLink({
  account,
  activation,
}: {
  account: Address;
  activation: ActivationStatus;
}) {
  const unstake = activation === "active" || activation === "activating";
  return (
    <ActionLink
      href={appLinks.withdraw(account)}
      label={unstake ? t("app.actions.unstake") : t("app.actions.withdraw")}
      icon={
        unstake ? (
          <CirclePauseIcon aria-hidden="true" />
        ) : (
          <ArrowDownToLineIcon aria-hidden="true" />
        )
      }
      variant="outline"
      account={account}
    />
  );
}

/** Delegate an inactive stake to a validator from an openly filtered list (DECISIONS.md D134). */
function DelegateLink({ account }: { account: Address }) {
  return (
    <ActionLink
      href={appLinks.delegate(account)}
      label={t("app.actions.delegate")}
      icon={<SproutIcon aria-hidden="true" />}
      variant="outline"
      account={account}
    />
  );
}

/** What a thief with only the main key could do to this account now, by simulation (DECISIONS.md D123). */
function StealLink({ account }: { account: Address }) {
  return (
    <ActionLink
      href={appLinks.steal(account)}
      label={t("app.actions.steal")}
      icon={<VenetianMaskIcon aria-hidden="true" />}
      variant="outline"
      account={account}
    />
  );
}

/** F7: hand the lock to a new second key (a second key that may be stolen). */
function ChangeKeyLink({ account }: { account: Address }) {
  return (
    <ActionLink
      href={appLinks.changeKey(account)}
      label={t("app.actions.changeKey")}
      icon={<KeyRoundIcon aria-hidden="true" />}
      variant="outline"
      account={account}
    />
  );
}

/**
 * Second-key list: the second key can extend (or remove) the lock it holds, hand it to a new second key, and keep the
 * card of that lock.
 */
function secondKeyActions(
  row: AccountView,
  primary: PrimaryAction,
): RowActions {
  return {
    action: <ExtendLink account={row.account.address} primary={primary} />,
    more: (
      <>
        <ChangeKeyLink account={row.account.address} />
        <RecoveryCardLink account={row.account.address} />
      </>
    ),
  };
}

/** The printable recovery card of the keys that lock this account (DECISIONS.md D74). */
function RecoveryCardLink({ account }: { account: Address }) {
  return (
    <ActionLink
      href={appLinks.recovery(account)}
      label={t("app.actions.recovery")}
      icon={<FileTextIcon aria-hidden="true" />}
      variant="outline"
      account={account}
    />
  );
}

/**
 * F6: accounts this device saw protected now stand without a lock. The page's only red block and, while it shows, the
 * page's one filled button (D112).
 */
function NoLongerProtectedBanner({
  accounts,
}: {
  accounts: readonly Address[];
}) {
  return (
    <Alert tone="danger" data-slot="no-longer-protected">
      <ShieldXIcon aria-hidden="true" />
      <AlertTitle>
        {accounts.length === 1
          ? t("app.noLongerProtected.titleOne")
          : t("app.noLongerProtected.titleOther", { count: accounts.length })}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p>
          {accounts.length === 1
            ? t("app.noLongerProtected.bodyOne")
            : t("app.noLongerProtected.body")}
        </p>
        <div className="shrink-0">
          <Button asChild variant="danger" size="sm">
            <Link href={appLinks.protect(accounts)}>
              <ShieldCheckIcon aria-hidden="true" />
              {t("app.noLongerProtected.action")}
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
