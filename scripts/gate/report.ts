// docs/gate.md: a short intro, then one section per cluster between markers. Each run rewrites only its own section.
import type { Address, Signature } from '@solana/kit';
import { STAKE_PROGRAM_RELEASE } from '@stakeward/core/test/support';
import type { Budget } from './budget.ts';
import type { GateCluster, ProgramElf } from './chain.ts';
import { describeExpectation } from './checks.ts';
import { formatTime, type CheckResult, type GateReport } from './run.ts';
import type { SweepResult } from './sweep.ts';
import { formatLamports, formatSol } from './tx.ts';

export const GATE_DOC = new URL('../../docs/gate.md', import.meta.url);

const CLUSTERS: readonly GateCluster[] = ['litesvm', 'devnet', 'mainnet'];
const HEADINGS: Record<GateCluster, string> = { litesvm: 'LiteSVM', devnet: 'Devnet', mainnet: 'Mainnet' };
const TABLE_HEADER = '| № | Проверка | Ожидание | Результат | Подпись или код ошибки |';
const FIXTURE_PATH = 'packages/core/test/fixtures/programs/stake-v5.1.0.so';

const INTRO = `# Проверка механизма

Скрипт \`scripts/gate.ts\` (CLAUDE.md, шаг 1) проверяет на настоящей стейк-программе правила замка (lockup), на которых
держится Stakeward. Транзакции, которые отправляет и продукт, собирает \`buildTransaction\` из \`packages/core\`: формат
из §4 и старый порядок аккаунтов для Ledger (D1). Действия, которых в продукте нет (AuthorizeChecked вора, Split,
Merge), собраны в том же формате. Неудачные транзакции в devnet и mainnet отправляются без preflight, поэтому у них
тоже есть подпись в сети. Ключи: A — основной, B — второй (хранитель замка), X — staker вора, D — новый кошелёк.

- LiteSVM: \`pnpm gate:litesvm\`. Тот же прогон идёт в CI как тест \`scripts/gate/gate.test.ts\`.
- Devnet: \`pnpm gate:devnet\`. Платит ключ-спонсор \`.keys/devnet-funder.json\`, ключи ролей прогона лежат в \`.keys/gate-devnet-<роль>.json\`, в конце всё, кроме комиссий, возвращается спонсору.
- Mainnet: \`pnpm gate:mainnet\`. Одноразовый ключ \`.keys/mainnet-gate.json\`, неделегированный аккаунт, проверки 2, 3, 4, 5, 6 и 13, в конце всё выводится обратно на этот ключ.

Адрес RPC задаёт переменная \`RPC_URL\`, по умолчанию — публичный узел кластера. Каждый прогон переписывает только
свой раздел этого файла.`;

const begin = (cluster: GateCluster) => `<!-- gate:${cluster}:begin -->`;
const end = (cluster: GateCluster) => `<!-- gate:${cluster}:end -->`;

function skeleton(): string {
  return [INTRO, ...CLUSTERS.map((c) => `${begin(c)}\n## ${HEADINGS[c]}\n\nЕщё не запускалась.\n${end(c)}`)].join('\n\n') + '\n';
}

/** Replaces the cluster's section (creating the file skeleton or the section when missing). */
export function upsertSection(doc: string | null, cluster: GateCluster, body: string): string {
  const base = doc ?? skeleton();
  const from = base.indexOf(begin(cluster));
  const to = base.indexOf(end(cluster));
  const section = `${begin(cluster)}\n${body.trim()}\n${end(cluster)}`;
  if (from === -1 || to < from) return `${base.trimEnd()}\n\n${section}\n`;
  return base.slice(0, from) + section + base.slice(to + end(cluster).length);
}

/** True when the cluster's section already holds a results table (a pending notice must not replace it). */
export function hasResults(doc: string | null, cluster: GateCluster): boolean {
  if (doc === null) return false;
  const from = doc.indexOf(begin(cluster));
  const to = doc.indexOf(end(cluster));
  return from !== -1 && to > from && doc.slice(from, to).includes(TABLE_HEADER);
}

function explorer(cluster: GateCluster, kind: 'tx' | 'address', value: string): string | null {
  if (cluster === 'litesvm') return null;
  return `https://explorer.solana.com/${kind}/${value}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}

function short(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function addressLink(cluster: GateCluster, address: Address): string {
  const url = explorer(cluster, 'address', address);
  return url === null ? `\`${address}\`` : `[\`${address}\`](${url})`;
}

function signatureLink(cluster: GateCluster, signature: Signature): string {
  const url = explorer(cluster, 'tx', signature);
  return url === null ? `\`${short(signature)}\`` : `[${short(signature)}](${url})`;
}

export function programLine(cluster: GateCluster, program: ProgramElf, matchesRelease: boolean): string {
  const verdict = matchesRelease
    ? `совпадает с релизом ${STAKE_PROGRAM_RELEASE} (фикстура \`${FIXTURE_PATH}\`)`
    : `НЕ совпадает с релизом ${STAKE_PROGRAM_RELEASE}`;
  const source = cluster === 'litesvm' ? 'загружена в LiteSVM из фикстуры; ' : '';
  return (
    `Стейк-программа: ${source}programdata ${addressLink(cluster, program.programData)}, слот развёртывания ` +
    `${String(program.deploySlot)}, ELF ${formatLamports(BigInt(program.size))} байт, sha256 \`${program.sha256}\`: ${verdict}.`
  );
}

function resultCell(result: CheckResult): string {
  const { outcome } = result;
  if (outcome === null) return 'не выполнялась';
  const actual = outcome.status === 'ok' ? 'успех' : outcome.status === 'failed' ? 'ошибка' : 'не попала в блок';
  const head = result.matched ? `совпало: ${actual}` : `**НЕ совпало**: ${actual}`;
  return result.note === null ? head : `${head}; ${result.note}`;
}

function signatureCell(cluster: GateCluster, result: CheckResult): string {
  const { outcome } = result;
  if (outcome === null) return '';
  const link = signatureLink(cluster, outcome.signature);
  return result.failure === null ? link : `${result.failure} · ${link}`;
}

export function resultsTable(report: GateReport): string {
  const rows = report.results.map((result) =>
    [result.id, result.title, describeExpectation(result.expected), resultCell(result), signatureCell(report.cluster, result)]
      .map((cell) => cell.replace(/\|/g, '\\|'))
      .join(' | '),
  );
  return [TABLE_HEADER, '|---|---|---|---|---|', ...rows.map((row) => `| ${row} |`)].join('\n');
}

export function summary(report: GateReport): string {
  const matched = report.results.filter((r) => r.matched).length;
  return `${String(matched)} из ${String(report.results.length)} шагов совпали с ожиданием`;
}

export function renderResults(report: GateReport): string {
  const { cluster } = report;
  const roles =
    cluster === 'mainnet'
      ? (['A', 'B', 'X'] as const).map((role) => `${role} ${addressLink(cluster, report.keys[role])}`)
      : (['A', 'B', 'X', 'D'] as const).map((role) => `${role} ${addressLink(cluster, report.keys[role])}`);
  const fees = report.fees.reduce((sum, entry) => sum + entry.fee, 0n);
  const lines = [
    `## ${HEADINGS[cluster]}`,
    '',
    `Прогон ${report.startedAt.toISOString().slice(0, 19).replace('T', ' ')} UTC: ${summary(report)}.`,
    ...(report.aborted === null ? [] : ['', `**Прогон остановлен:** ${report.aborted}`]),
    '',
    `- ${programLine(cluster, report.program, report.programMatchesRelease)}`,
    `- Часы кластера в начале: ${formatTime(report.clockAtStart.unixTimestamp)}, эпоха ${String(report.clockAtStart.epoch)}.`,
    `- Ключи: ${roles.join(', ')}.` +
      (cluster === 'mainnet'
        ? ` A — одноразовый ключ \`.keys/mainnet-gate.json\`, он же платит.`
        : ` Спонсор ${addressLink(cluster, report.keys.funder)}.`),
    ...(report.voteAccount === null ? [] : [`- Делегация на vote-аккаунт ${addressLink(cluster, report.voteAccount)}.`]),
    `- Транзакций: ${String(report.fees.length)}, комиссии сети: ${formatLamports(fees)} лампортов (${formatSol(fees)}). ` +
      `На старте у плательщика было ровно ${formatSol(report.budget.required)}.`,
    ...(report.sweep === null ? [] : sweepLines(report.sweep)),
    '',
    resultsTable(report),
  ];
  return lines.join('\n');
}

function sweepLines(sweep: SweepResult): string[] {
  const head = sweep.clean
    ? '- Возврат средств завершён, ключи ролей пусты'
    : '- Возврат средств **не завершён**, файлы ключей сохранены';
  return [`${head}${sweep.notes.length === 0 ? '.' : ':'}`, ...sweep.notes.map((note) => `  - ${note}`)];
}

export type PendingInfo = {
  cluster: 'devnet' | 'mainnet';
  address: Address;
  keyFile: string;
  balance: bigint;
  budget: Budget;
  program: ProgramElf;
  programMatchesRelease: boolean;
};

export function renderPending(info: PendingInfo): string {
  const { cluster, budget } = info;
  const how =
    cluster === 'devnet'
      ? 'Пополнить: https://faucet.solana.com (devnet) или переводом с devnet-кошелька, затем `pnpm gate:devnet`.'
      : 'Удобно перевести 0,02 SOL, затем `pnpm gate:mainnet`. Остаток потом выводится одной командой: ' +
        '`solana transfer --from .keys/mainnet-gate.json <ваш адрес> ALL --url mainnet-beta`.';
  return [
    `## ${HEADINGS[cluster]}`,
    '',
    `**Ожидает пополнения.** Адрес ${addressLink(cluster, info.address)} (\`${info.keyFile}\`), баланс сейчас ` +
      `${formatSol(info.balance)}. Нужно не меньше **${formatSol(budget.required)}** ` +
      `(${formatLamports(budget.required)} лампортов):`,
    '',
    ...budget.items.map((item) => `- ${item.label}: ${formatLamports(item.lamports)}`),
    '',
    `Не вернутся только комиссии сети: ${formatSol(budget.fees)}. ${how}`,
    '',
    `- ${programLine(cluster, info.program, info.programMatchesRelease)}`,
  ].join('\n');
}

/** Plain-text table for the terminal. */
export function consoleReport(report: GateReport): string {
  const lines = report.results.map((r) => {
    const status = r.outcome === null ? 'not run' : r.matched ? 'ok' : 'MISMATCH';
    const failure = r.failure === null ? '' : ` [${r.failure}]`;
    return `${r.id.padEnd(4)}${status.padEnd(9)}${describeExpectation(r.expected).padEnd(34)}${r.title}${failure}`;
  });
  const stopped = report.aborted === null ? '' : `; stopped: ${report.aborted}`;
  return [...lines, '', `${HEADINGS[report.cluster]}: ${summary(report)}${stopped}`].join('\n');
}
