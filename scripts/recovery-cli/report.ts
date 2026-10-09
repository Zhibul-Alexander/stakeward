// docs/recovery-cli.md: a short intro, then one section per cluster between markers. Each run rewrites only its own
// section.
import { formatLamports, formatSol } from '../gate/tx.ts';
import { redactText, redactUrl, type RecoveryCluster } from './args.ts';
import type { CheckResult } from './checks.ts';

export const RECOVERY_CLI_DOC = new URL('../../docs/recovery-cli.md', import.meta.url);

const CLUSTERS: readonly RecoveryCluster[] = ['localnet', 'devnet'];
const HEADINGS: Record<RecoveryCluster, string> = { localnet: 'Localnet (solana-test-validator)', devnet: 'Devnet' };
export const TABLE_HEADER = '| № | Команда карточки | Ожидание | Результат | Подпись или сообщение |';

const INTRO = `# Команды карточки восстановления

Скрипт \`scripts/recovery-cli.ts\` (шаг 8, DECISIONS D78) выполняет каждую команду Solana CLI из карточки
восстановления (\`recoveryCommands\` в \`packages/core/src/recovery.ts\`) на настоящем кластере. Команда набирается так,
как её набирает человек: строка карточки, вместо каждого \`<…>\` — путь к файлу ключа, адрес или дата в двойных
кавычках, запуск через \`bash -c\` (и \`zsh -c\`, если zsh установлен). HOME и рабочая папка команд — пустая папка,
поэтому им не нужны ни конфигурация CLI, ни ключ по умолчанию. Перед запуском скрипт проверяет, что каждая оболочка
разбирает строку ровно в те аргументы, которые должна получить программа.

Ключи прогона одноразовые и лежат в \`.keys/recovery-<кластер>/\`: A — основной ключ, K — второй, K2 — новый второй,
D — новый кошелёк, X — вор с украденным A. Проверки C должны пройти; проверки N должны упасть с тем сообщением, которое
объясняет карточка; H сверяет флаги шаблонов с \`solana <команда> --help\`; S1 — вид с переносами строк; I1 — адрес
установщика. В конце всё, кроме комиссий сети, возвращается спонсору.

- Localnet: запустить \`solana-test-validator\`, затем \`pnpm recovery-cli --url localhost --funder <файл ключа с SOL>\`.
- Devnet: \`pnpm recovery-cli --url devnet\`, спонсор \`.keys/devnet-funder.json\` (около 1,15 SOL; около 0,13 SOL с
  \`--skip-delegated\`, тогда N3, N9 и C8 не выполняются).

Mainnet скрипт не запускает (проверка по genesis hash). Каждый прогон переписывает только свой раздел этого файла.
Адрес RPC провайдера (\`--url <адрес>\`) этот файл и консоль показывают только началом, \`https://<хост>/…\`: ключ API из
адреса никуда не записывается.`;

const begin = (cluster: RecoveryCluster) => `<!-- recovery-cli:${cluster}:begin -->`;
const end = (cluster: RecoveryCluster) => `<!-- recovery-cli:${cluster}:end -->`;

function skeleton(): string {
  return (
    [INTRO, ...CLUSTERS.map((c) => `${begin(c)}\n## ${HEADINGS[c]}\n\nЕщё не запускался.\n${end(c)}`)].join('\n\n') +
    '\n'
  );
}

/** Replaces the cluster's section (creating the file skeleton or the section when missing). */
export function upsertSection(doc: string | null, cluster: RecoveryCluster, body: string): string {
  const base = doc ?? skeleton();
  const from = base.indexOf(begin(cluster));
  const to = base.indexOf(end(cluster));
  const section = `${begin(cluster)}\n${body.trim()}\n${end(cluster)}`;
  if (from === -1 || to < from) return `${base.trimEnd()}\n\n${section}\n`;
  return base.slice(0, from) + section + base.slice(to + end(cluster).length);
}

export type RecoveryCliReport = {
  cluster: RecoveryCluster;
  url: string;
  startedAt: Date;
  /** `solana --version`. */
  cliVersion: string;
  /** `GNU bash, version 5.2.21…` for each shell the card commands went through. */
  shells: string[];
  funder: string;
  /** Role label and address, in table order. */
  keys: { role: string; address: string }[];
  /** Lock end dates the run set, as `T = …`. */
  locks: string[];
  results: CheckResult[];
  /** Funder balance at the start minus at the end; null when it could not be read. */
  spent: bigint | null;
  notes: string[];
  aborted: string | null;
};

function explorer(cluster: RecoveryCluster, kind: 'tx' | 'address', value: string): string | null {
  return cluster === 'devnet' ? `https://explorer.solana.com/${kind}/${value}?cluster=devnet` : null;
}

function short(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function addressCell(cluster: RecoveryCluster, address: string): string {
  const url = explorer(cluster, 'address', address);
  return url === null ? `\`${address}\`` : `[\`${address}\`](${url})`;
}

function signatureCell(cluster: RecoveryCluster, signature: string): string {
  const url = explorer(cluster, 'tx', signature);
  return url === null ? `\`${short(signature)}\`` : `[${short(signature)}](${url})`;
}

/** Inline code that survives backticks inside the text. */
function code(text: string): string {
  const fence = text.includes('`') ? '``' : '`';
  return `${fence}${fence === '``' ? ` ${text} ` : text}${fence}`;
}

function evidenceCell(cluster: RecoveryCluster, result: CheckResult): string {
  const parts = [
    ...(result.message === null ? [] : [code(result.message)]),
    ...result.signatures.map((signature) => signatureCell(cluster, signature)),
  ];
  return parts.join(' · ');
}

function resultCell(result: CheckResult): string {
  const head = result.passed ? 'прошла' : '**НЕ прошла**';
  return result.outcome === '' ? head : `${head}: ${result.outcome}`;
}

export function resultsTable(report: RecoveryCliReport): string {
  const rows = report.results.map((result) =>
    [result.id, result.title, result.expected, resultCell(result), evidenceCell(report.cluster, result)]
      .map((cell) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' '))
      .join(' | '),
  );
  return [TABLE_HEADER, '|---|---|---|---|---|', ...rows.map((row) => `| ${row} |`)].join('\n');
}

export function summary(report: RecoveryCliReport): string {
  const passed = report.results.filter((result) => result.passed).length;
  return `${String(passed)} из ${String(report.results.length)} проверок прошли`;
}

/** The section for docs/recovery-cli.md, which is committed: the RPC URL is redacted everywhere in it. */
export function renderSection(report: RecoveryCliReport): string {
  const { cluster } = report;
  const lines = [
    `## ${HEADINGS[cluster]}`,
    '',
    `Прогон ${report.startedAt.toISOString().slice(0, 19).replace('T', ' ')} UTC: ${summary(report)}.`,
    ...(report.aborted === null ? [] : ['', `**Прогон остановлен:** ${report.aborted}`]),
    '',
    `- ${report.cliVersion}; RPC \`${redactUrl(report.url)}\`.`,
    `- Оболочки: ${report.shells.join('; ')}.`,
    `- Ключи: ${report.keys.map((key) => `${key.role} ${addressCell(cluster, key.address)}`).join(', ')}. ` +
      `Спонсор ${addressCell(cluster, report.funder)}.`,
    ...(report.locks.length === 0 ? [] : [`- Замки по часам кластера: ${report.locks.join(', ')}.`]),
    ...(report.spent === null
      ? []
      : [
          `- Потрачено спонсором: ${formatLamports(report.spent)} лампортов (${formatSol(report.spent)}); ` +
            'остальное вернулось.',
        ]),
    ...report.notes.map((note) => `- ${note}`),
    '',
    resultsTable(report),
  ];
  return redactText(lines.join('\n'), report.url);
}

/** Plain-text table for the terminal. */
export function consoleReport(report: RecoveryCliReport): string {
  const lines = report.results.map((result) => {
    const status = result.passed ? 'ok' : 'FAILED';
    const detail = result.passed ? '' : ` [${result.outcome}]`;
    return `${result.id.padEnd(5)}${status.padEnd(8)}${result.title}${detail}`;
  });
  const stopped = report.aborted === null ? '' : `; stopped: ${report.aborted}`;
  return redactText([...lines, '', `${HEADINGS[report.cluster]}: ${summary(report)}${stopped}`].join('\n'), report.url);
}
