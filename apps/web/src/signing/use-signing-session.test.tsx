import type { Address } from '@solana/kit';
import type { ChainPort, StakeAccount } from '@stakeward/core';
import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { SigningSession } from './session.ts';
import type { SigningPlan } from './types.ts';
import { useSigningSession } from './use-signing-session.ts';

const S1 = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
const AFTER = { address: S1 } as StakeAccount;

/** A plan that finds every job already done: the session finishes without a transaction or a wallet. */
const DONE_PLAN: SigningPlan = {
  prepare: (_chain, ids) =>
    Promise.resolve({
      clock: { slot: 1n, epochStartTimestamp: 1n, epoch: 1n, unixTimestamp: 1n },
      jobs: Object.fromEntries(ids.map((id) => [id, { kind: 'done', after: AFTER } as const])),
    }),
};

function Probe({ create, runKey }: { create: () => SigningSession; runKey: string }) {
  const { session, snapshot } = useSigningSession(create, runKey);
  return (
    <p data-testid="phase" data-session={session === null ? 'none' : 'attached'}>
      {snapshot?.phase.kind ?? 'none'}
    </p>
  );
}

describe('useSigningSession', () => {
  it('creates the session in an effect (StrictMode: the first one is disposed) and follows its state', async () => {
    const sessions: SigningSession[] = [];
    const disposed: Mock<() => void>[] = [];
    const onFinished = vi.fn();
    const create = () => {
      const session = new SigningSession({
        chain: {} as ChainPort,
        plan: DONE_PLAN,
        ids: [S1],
        resolveSigner: () => ({ kind: 'missing', role: 'main' }),
        appendsTail: () => false,
        onFinished,
      });
      disposed.push(vi.spyOn(session, 'dispose'));
      sessions.push(session);
      return session;
    };
    const { rerender, unmount } = render(
      <StrictMode>
        <Probe create={create} runKey="run#1" />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('phase')).toHaveTextContent('finished');
    });
    expect(screen.getByTestId('phase')).toHaveAttribute('data-session', 'attached');
    expect(sessions).toHaveLength(2);
    expect(disposed[0]).toHaveBeenCalledTimes(1);
    expect(disposed[1]).not.toHaveBeenCalled();
    // The disposed session never reports its end.
    expect(onFinished).toHaveBeenCalledTimes(1);

    // A new key is a new run; the same key keeps the session.
    rerender(
      <StrictMode>
        <Probe create={create} runKey="run#1" />
      </StrictMode>,
    );
    expect(sessions).toHaveLength(2);
    rerender(
      <StrictMode>
        <Probe create={create} runKey="run#2" />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(sessions).toHaveLength(3);
    });
    expect(disposed[1]).toHaveBeenCalledTimes(1);
    unmount();
    expect(disposed[2]).toHaveBeenCalledTimes(1);
  });
});
