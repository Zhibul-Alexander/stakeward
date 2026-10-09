import { Badge, Spinner } from '@stakeward/design-system';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  FlaskConicalIcon,
  GlobeIcon,
  HourglassIcon,
  PauseIcon,
  TimerOffIcon,
  WifiOffIcon,
} from 'lucide-react';

/**
 * The status tones, as the per-account list of a signing run uses them: a soft fill with the tone's text, always a
 * word and an icon too. `outline` keeps a frame. (The `primary` tone exists, but no screen uses it.)
 */
export const Tones = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge tone="outline">
      <CircleDashedIcon aria-hidden="true" />
      Waiting
    </Badge>
    <Badge tone="info">
      <HourglassIcon aria-hidden="true" />
      Confirming
    </Badge>
    <Badge tone="success">
      <CircleCheckIcon aria-hidden="true" />
      Done
    </Badge>
    <Badge tone="warning">
      <TimerOffIcon aria-hidden="true" />
      Expired, nothing changed
    </Badge>
    <Badge tone="danger">
      <CircleXIcon aria-hidden="true" />
      Did not go through
    </Badge>
    <Badge tone="neutral">
      <CircleSlashIcon aria-hidden="true" />
      Not sent
    </Badge>
  </div>
);

/**
 * `sm` (text-xs, the default) in rows and lists, the top line; `md` (text-sm) where the badge stands on its own, the
 * bottom line.
 */
export const Sizes = () => (
  <div className="flex flex-col items-start gap-3">
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="success" size="sm">
        <CircleCheckIcon aria-hidden="true" />
        Signed
      </Badge>
      <Badge tone="outline" size="sm">
        <PauseIcon aria-hidden="true" />
        Stopped checking
      </Badge>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="success" size="md">
        <CircleCheckIcon aria-hidden="true" />
        Signed
      </Badge>
      <Badge tone="outline" size="md">
        <PauseIcon aria-hidden="true" />
        Stopped checking
      </Badge>
    </div>
  </div>
);

/** Signing by link on the first device: what the wait for the other device is doing right now. */
export const LinkStatus = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge tone="info" size="md">
      <Spinner aria-hidden="true" />
      Waiting for the other device
    </Badge>
    <Badge tone="warning" size="md">
      <WifiOffIcon aria-hidden="true" />
      Network unreachable, still trying
    </Badge>
    <Badge tone="outline" size="md">
      <PauseIcon aria-hidden="true" />
      Stopped checking
    </Badge>
  </div>
);

/** The network: on the landing hero (mainnet) and in the site header of a devnet build, next to its note. */
export const Network = () => (
  <div className="flex flex-col gap-3">
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:text-sm">
      <Badge tone="outline">
        <GlobeIcon aria-hidden="true" />
        Solana mainnet
      </Badge>
      <span>This site works with real SOL.</span>
    </p>
    <div className="flex min-w-0 items-center gap-2">
      <Badge tone="outline">
        <FlaskConicalIcon aria-hidden="true" />
        Devnet
      </Badge>
      <span className="hidden text-xs text-muted md:inline">Test network: no real SOL.</span>
    </div>
  </div>
);

/** Recommended next to the lock period it marks, with the period's end under it (a lock-period card's words). */
export const Recommended = () => (
  <span className="flex flex-col gap-1">
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-sm font-medium text-foreground">6 months</span>
      <Badge tone="success">Recommended</Badge>
    </span>
    <span className="text-sm text-muted tabular-nums">until 10 April 2027</span>
  </span>
);
