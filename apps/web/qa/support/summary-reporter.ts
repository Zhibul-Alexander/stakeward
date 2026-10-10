// Writes .cache/qa-report/summary.md: one line per scenario and viewport, so an agent (or a person) can read the
// outcome of a run without opening the HTML report.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { QA } from './env.ts';

// ANSI colour codes in Playwright's error messages.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const OUT = fileURLToPath(new URL('../../.cache/qa-report/summary.md', import.meta.url));

export default class SummaryReporter implements Reporter {
  private readonly rows: { title: string; project: string; status: string; seconds: string; error: string; files: string[] }[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    const project = test.parent.project()?.name ?? '';
    const error = (result.error?.message ?? '').replace(ANSI, '').split('\n').find((line) => line.trim() !== '') ?? '';
    this.rows.push({
      title: test.titlePath().slice(3).join(' > '),
      project,
      status: result.status === 'skipped' ? `skipped${test.annotations.find((a) => a.type === 'skip')?.description ? `: ${String(test.annotations.find((a) => a.type === 'skip')?.description)}` : ''}` : result.status,
      seconds: (result.duration / 1000).toFixed(1),
      error: error.slice(0, 300),
      files: result.attachments.filter((a) => a.path !== undefined).map((a) => `${a.name}: ${String(a.path)}`),
    });
  }

  onEnd(result: FullResult): void {
    const count = (status: string) => this.rows.filter((row) => row.status.startsWith(status)).length;
    const lines = [
      `# QA run: ${result.status}`,
      '',
      `Target: ${QA.target} (${QA.baseUrl}), RPC ${QA.target === 'local' ? 'local LiteSVM' : QA.rpcUrl}. ${new Date().toISOString()}`,
      `Passed ${String(count('passed'))}, failed ${String(count('failed') + count('timedOut'))}, skipped ${String(count('skipped'))}.`,
      '',
      '| Scenario | Viewport | Result | s |',
      '| --- | --- | --- | --- |',
      ...this.rows.map((row) => `| ${row.title} | ${row.project} | ${row.status === 'passed' ? 'passed' : `**${row.status}**`} | ${row.seconds} |`),
      '',
      ...this.rows
        .filter((row) => row.status === 'failed' || row.status === 'timedOut')
        .flatMap((row) => [`## ${row.title} (${row.project})`, '', '```', row.error, '```', ...row.files.map((file) => `- ${file}`), '']),
    ];
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, lines.join('\n'));
    console.log(`QA summary: ${join('apps/web/.cache/qa-report/summary.md')}`);
  }
}
