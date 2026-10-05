// Test-only ChainPort wrapper for page tests: forwards every call to the inner chain (a LiteSvmChain in the scenario
// tests) and records it, so a test can say "nothing was simulated or sent" (/cosign refusals). Never imported from src;
// marked so no build can carry it.
import type { Address, ReadonlyUint8Array, Signature } from '@solana/kit';
import type { ChainPort, SimulationResult, StakeAccountFilter } from '@stakeward/core';

export const COUNTING_CHAIN_MARKER = 'stakeward-test-only:counting-chain';

export type ChainMethod = keyof ChainPort;

/** Every ChainPort call, in call order, then forwarded unchanged. */
export class CountingChain implements ChainPort {
  readonly marker = COUNTING_CHAIN_MARKER;
  readonly calls: { method: ChainMethod; args: readonly unknown[] }[] = [];
  readonly inner: ChainPort;

  constructor(inner: ChainPort) {
    this.inner = inner;
  }

  /** How many times `method` was called. */
  count(method: ChainMethod): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  private record(method: ChainMethod, args: readonly unknown[]): void {
    this.calls.push({ method, args });
  }

  getAccounts(addresses: readonly Address[]) {
    this.record('getAccounts', [addresses]);
    return this.inner.getAccounts(addresses);
  }
  getClock() {
    this.record('getClock', []);
    return this.inner.getClock();
  }
  getLatestBlockhash() {
    this.record('getLatestBlockhash', []);
    return this.inner.getLatestBlockhash();
  }
  getBlockHeight() {
    this.record('getBlockHeight', []);
    return this.inner.getBlockHeight();
  }
  getEpochInfo() {
    this.record('getEpochInfo', []);
    return this.inner.getEpochInfo();
  }
  getBalance(address: Address) {
    this.record('getBalance', [address]);
    return this.inner.getBalance(address);
  }
  getMinimumBalanceForRentExemption(size: number) {
    this.record('getMinimumBalanceForRentExemption', [size]);
    return this.inner.getMinimumBalanceForRentExemption(size);
  }
  simulate(transaction: ReadonlyUint8Array): Promise<SimulationResult> {
    this.record('simulate', [transaction]);
    return this.inner.simulate(transaction);
  }
  send(transaction: ReadonlyUint8Array) {
    this.record('send', [transaction]);
    return this.inner.send(transaction);
  }
  getSignatureStatuses(signatures: readonly Signature[]) {
    this.record('getSignatureStatuses', [signatures]);
    return this.inner.getSignatureStatuses(signatures);
  }
  findStakeAccounts(filter: StakeAccountFilter) {
    this.record('findStakeAccounts', [filter]);
    return this.inner.findStakeAccounts(filter);
  }
}
