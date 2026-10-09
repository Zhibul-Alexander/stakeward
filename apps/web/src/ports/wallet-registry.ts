import type { WalletPort } from '@stakeward/core';
import { getWallets, type Wallets } from '@wallet-standard/app';
import type { IdentifierString, Wallet } from '@wallet-standard/base';
import { StandardEvents, type StandardEventsFeature } from '@wallet-standard/features';
import { isSupportedWallet, StandardWalletPort } from './wallet-standard.ts';

/**
 * The wallets the user can connect, as an external store for React (useSyncExternalStore). The snapshot is a new
 * array whenever the list or anything a wallet shows (its accounts) changes, and the same array otherwise.
 */
export interface WalletRegistry {
  getSnapshot: () => readonly WalletPort[];
  subscribe: (listener: () => void) => () => void;
}

/** A registry over a fixed set of ports: tests, and anything that is not Wallet Standard. */
export class StaticWalletRegistry implements WalletRegistry {
  private ports: readonly WalletPort[] = [];
  private snapshot: readonly WalletPort[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly stops = new Map<WalletPort, () => void>();

  constructor(ports: readonly WalletPort[] = []) {
    this.set(ports);
  }

  readonly getSnapshot = (): readonly WalletPort[] => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Replaces the list; ports keep their order. Two ports with the same id: the first one wins. */
  set(ports: readonly WalletPort[]): void {
    const unique = ports.filter((port, index) => ports.findIndex((other) => other.id === port.id) === index);
    for (const [port, stop] of this.stops) {
      if (!unique.includes(port)) {
        stop();
        this.stops.delete(port);
      }
    }
    for (const port of unique) {
      if (!this.stops.has(port)) this.stops.set(port, port.onChange(this.changed));
    }
    this.ports = unique;
    this.changed();
  }

  add(port: WalletPort): void {
    this.set([...this.ports, port]);
  }

  remove(port: WalletPort): void {
    this.set(this.ports.filter((other) => other !== port));
  }

  /** Stops listening to the ports. */
  dispose(): void {
    for (const stop of this.stops.values()) stop();
    this.stops.clear();
    this.listeners.clear();
  }

  private readonly changed = (): void => {
    this.snapshot = [...this.ports];
    for (const listener of [...this.listeners]) listener();
  };
}

/**
 * Wallet Standard discovery: every wallet registered with `getWallets()` (now or later) that supports the cluster's
 * chain, connecting and legacy transaction signing. Watches register/unregister and each wallet's `change` events,
 * since a wallet object changes in place (its accounts, features and chains).
 */
export class StandardWalletRegistry implements WalletRegistry {
  private readonly list = new StaticWalletRegistry();
  private readonly chain: IdentifierString;
  private readonly wallets: Wallets;
  private readonly ports = new Map<Wallet, StandardWalletPort>();
  private readonly watched = new Map<Wallet, () => void>();
  private readonly stops: (() => void)[];

  constructor(chain: IdentifierString, wallets: Wallets = getWallets()) {
    this.chain = chain;
    this.wallets = wallets;
    this.stops = [wallets.on('register', this.refresh), wallets.on('unregister', this.refresh)];
    this.refresh();
  }

  readonly getSnapshot = (): readonly WalletPort[] => this.list.getSnapshot();

  readonly subscribe = (listener: () => void): (() => void) => this.list.subscribe(listener);

  dispose(): void {
    for (const stop of this.stops) stop();
    for (const stop of this.watched.values()) stop();
    this.watched.clear();
    this.list.dispose();
  }

  private readonly refresh = (): void => {
    const registered = this.wallets.get();
    for (const [wallet, stop] of this.watched) {
      if (!registered.includes(wallet)) {
        stop();
        this.watched.delete(wallet);
        this.ports.delete(wallet);
      }
    }
    const supported: StandardWalletPort[] = [];
    for (const wallet of registered) {
      // A wallet may start supporting the chain or the features later: re-check on its change events.
      if (!this.watched.has(wallet)) this.watched.set(wallet, watch(wallet, this.refresh));
      if (!isSupportedWallet(wallet, this.chain)) {
        this.ports.delete(wallet);
        continue;
      }
      let port = this.ports.get(wallet);
      if (port === undefined) {
        port = new StandardWalletPort(wallet, this.chain);
        this.ports.set(wallet, port);
      }
      supported.push(port);
    }
    this.list.set(supported);
  };
}

function watch(wallet: Wallet, listener: () => void): () => void {
  const feature = wallet.features[StandardEvents] as Partial<StandardEventsFeature[typeof StandardEvents]> | undefined;
  if (typeof feature?.on !== 'function') return () => undefined;
  try {
    return feature.on('change', listener);
  } catch {
    return () => undefined;
  }
}
