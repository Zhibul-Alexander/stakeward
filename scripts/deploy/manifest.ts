// What a deploy shipped (SECURITY-CHECK P18): the sha256 of every file of the site build, the commit and wrangler's
// version id, appended to docs/deploys.md.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Cluster, DeployEnv } from './args.ts';

export const DEPLOYS_DOC = new URL('../../docs/deploys.md', import.meta.url);

export type FileHash = { path: string; bytes: number; sha256: string };

/** Every file under `dir`, with its path relative to `dir` (posix separators), sorted by path. */
export function hashTree(dir: string): FileHash[] {
  const files: FileHash[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        const content = readFileSync(path);
        files.push({
          path: relative(dir, path).split(sep).join('/'),
          bytes: content.length,
          sha256: createHash('sha256').update(content).digest('hex'),
        });
      }
    }
  };
  walk(dir);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** `removed: …`, `added: …`, `changed: …` for each path that differs, in path order; empty when the same. */
export function manifestChanges(before: readonly FileHash[], after: readonly FileHash[]): string[] {
  const old = new Map(before.map((file) => [file.path, file.sha256]));
  const now = new Map(after.map((file) => [file.path, file.sha256]));
  const paths = [...new Set([...old.keys(), ...now.keys()])].sort();
  const changes: string[] = [];
  for (const path of paths) {
    const a = old.get(path);
    const b = now.get(path);
    if (b === undefined) changes.push(`removed: ${path}`);
    else if (a === undefined) changes.push(`added: ${path}`);
    else if (a !== b) changes.push(`changed: ${path}`);
  }
  return changes;
}

/** The `deploy` entry wrangler appends to WRANGLER_OUTPUT_FILE_PATH (newline-delimited JSON); the last one wins. */
export function parseWranglerOutput(ndjson: string): { versionId: string; targets: string[] } {
  let deploy: Record<string, unknown> | null = null;
  for (const line of ndjson.split('\n')) {
    if (line.trim() === '') continue;
    const entry: unknown = JSON.parse(line);
    if (typeof entry === 'object' && entry !== null && (entry as { type?: unknown }).type === 'deploy') {
      deploy = entry as Record<string, unknown>;
    }
  }
  if (deploy === null) throw new Error('wrangler output has no deploy entry');
  const versionId = deploy['version_id'];
  if (typeof versionId !== 'string' || versionId === '') throw new Error('the wrangler deploy entry has no version_id');
  const targets = Array.isArray(deploy['targets'])
    ? deploy['targets'].filter((target): target is string => typeof target === 'string')
    : [];
  return { versionId, targets };
}

export type DeployRecord = {
  env: DeployEnv;
  cluster: Cluster;
  branch: string;
  commit: string;
  /** False when deployed with --allow-unpushed and HEAD was not origin/<branch>. */
  pushed: boolean;
  versionId: string;
  targets: string[];
  deployedAt: Date;
  tools: { node: string; pnpm: string; wrangler: string };
  files: FileHash[];
};

export const DEPLOYS_INTRO = `# Деплои

Каждый \`pnpm deploy:dev\` и \`pnpm deploy:prod\` (обёртка \`scripts/deploy.ts\`, SECURITY-CHECK П18 и П19) дописывает
сюда раздел: окружение, коммит, version id Cloudflare и sha256 каждого выгруженного файла сайта (\`apps/web/dist\`).
Обёртка деплоит только чистое дерево, HEAD которого совпадает с origin/<ветка> (для dev можно \`--allow-unpushed\`, это
отмечено в разделе), ставит зависимости с frozen lockfile, собирает сайт без секретов в окружении и прогоняет
\`build-output.test.ts\` и \`test-code-guard.test.ts\` на этой самой папке. Токен Cloudflare и id аккаунта получает только
\`wrangler deploy\`.

Сверить живой сайт с коммитом: \`pnpm verify-deploy --env <dev|prod> --commit <sha>\`. Скрипт заново собирает коммит во
временной копии репозитория и сравнивает sha256 каждого файла сборки с тем, что отдаёт сайт. Код воркера
(\`apps/worker\`) wrangler собирает сам при выгрузке; его хеша здесь нет.`;

function utc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** One deploy as a Markdown section for docs/deploys.md. */
export function renderDeploySection(record: DeployRecord): string {
  const origin = record.pushed
    ? `совпадает с origin/${record.branch}`
    : `не на origin/${record.branch} (\`--allow-unpushed\`)`;
  const lines = [
    `## ${record.env} · ${utc(record.deployedAt)}`,
    '',
    `- Коммит: \`${record.commit}\`, ветка \`${record.branch}\`, ${origin}.`,
    `- Version ID: \`${record.versionId}\`.`,
    `- Цели: ${record.targets.length === 0 ? '—' : record.targets.map((target) => `\`${target}\``).join(', ')}.`,
    `- Сборка сайта: ${record.cluster}; Node ${record.tools.node}, pnpm ${record.tools.pnpm}, wrangler ${record.tools.wrangler}.`,
    '- На этой папке прошли `build-output.test.ts` и `test-code-guard.test.ts`; после выгрузки файлы не изменились.',
    `- Сверить сайт с коммитом: \`pnpm verify-deploy --env ${record.env} --commit ${record.commit}\`.`,
    '',
    '| файл | байт | sha256 |',
    '|---|---|---|',
    ...record.files.map((file) => `| \`${file.path}\` | ${String(file.bytes)} | \`${file.sha256}\` |`),
  ];
  return lines.join('\n');
}

/** docs/deploys.md with `section` added at the end (the intro first when the file does not exist yet). */
export function appendDeploySection(doc: string | null, section: string): string {
  const base = doc === null || doc.trim() === '' ? DEPLOYS_INTRO : doc.trimEnd();
  return `${base}\n\n${section.trim()}\n`;
}
