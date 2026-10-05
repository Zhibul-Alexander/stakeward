// Wall-time measurement inside workerd for the CPU tests (test/cpu.test.ts, test/monitor-cpu.test.ts). Local workerd
// advances performance.now() during computation, so averages over many runs are meaningful here (production Workers
// freeze timers during execution and would read 0).

const WARMUP_RUNS = 200;
const BATCHES = 7;
const BATCH_RUNS = 40;

export type Measurement = { firstMs: number; minMs: number; medianMs: number };

/**
 * `firstMs`: the first call (in the first test of this file, the first in a fresh isolate: cold). Then WARMUP_RUNS
 * untimed calls, then BATCHES batches of BATCH_RUNS calls: `minMs` and `medianMs` are the lowest and the median batch
 * average (warm). The clock is wall time in whole milliseconds and the machine may be busy, so the lowest batch is
 * the closest to the CPU cost.
 */
export async function measure(run: () => Promise<unknown>): Promise<Measurement> {
  const start = performance.now();
  await run();
  const firstMs = performance.now() - start;
  for (let i = 0; i < WARMUP_RUNS; i++) await run();
  const averages: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const batchStart = performance.now();
    for (let i = 0; i < BATCH_RUNS; i++) await run();
    averages.push((performance.now() - batchStart) / BATCH_RUNS);
  }
  averages.sort((a, b) => a - b);
  return { firstMs, minMs: averages[0] ?? NaN, medianMs: averages[Math.floor(BATCHES / 2)] ?? NaN };
}

export function report(label: string, result: Measurement) {
  console.log(
    `[cpu] ${label}: first ${result.firstMs.toFixed(1)} ms, warm min ${result.minMs.toFixed(2)} ms, median ${result.medianMs.toFixed(2)} ms`,
  );
}
