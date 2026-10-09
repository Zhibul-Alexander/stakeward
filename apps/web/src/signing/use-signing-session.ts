import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import type { SigningState } from './machine.ts';
import type { SigningSession } from './session.ts';

type Attached = { session: SigningSession; snapshot: SigningState };

/**
 * Publishes the attached session and its state as one external store for React. The snapshot object changes only
 * when the session's state changes or another session is attached, so `useSyncExternalStore` stays stable.
 */
export class SessionHost {
  private current: Attached | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  attach(session: SigningSession): void {
    this.unsubscribe?.();
    this.unsubscribe = session.subscribe(() => {
      if (this.current?.session !== session) return;
      this.current = { session, snapshot: session.getSnapshot() };
      this.notify();
    });
    this.current = { session, snapshot: session.getSnapshot() };
    this.notify();
  }

  detach(session: SigningSession): void {
    if (this.current?.session !== session) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.current = null;
    this.notify();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** null while no session is attached. */
  readonly getSnapshot = (): Attached | null => this.current;

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * One signing session per `key` (a new key = a new run). The session is created and started inside an effect, never
 * during render, and disposed when the key changes or the component unmounts. Under StrictMode the first session is
 * disposed while it only reads the chain: it never reaches a wallet, which waits for the user's click.
 */
export function useSigningSession(
  create: () => SigningSession,
  key: string,
): { session: SigningSession | null; snapshot: SigningState | null } {
  const [host] = useState(() => new SessionHost());
  const createEvent = useEffectEvent(create);
  useEffect(() => {
    const session = createEvent();
    host.attach(session);
    session.start();
    return () => {
      host.detach(session);
      session.dispose();
    };
  }, [host, key]);
  const attached = useSyncExternalStore(host.subscribe, host.getSnapshot);
  return { session: attached?.session ?? null, snapshot: attached?.snapshot ?? null };
}
