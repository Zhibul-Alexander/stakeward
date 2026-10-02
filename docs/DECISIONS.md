# Решения

Каждое решение: дата, что решили и почему. Расхождения с CLAUDE.md записываются сюда же.

## D1. Ledger: устаревший порядок аккаунтов (02.10.2026)

Withdraw, AuthorizeChecked, Deactivate и DelegateStake собираем в старом (legacy) порядке аккаунтов: в инструкцию от `@solana-program/stake` 0.10.0 вставляем sysvar-аккаунты (Clock, для Withdraw и DelegateStake ещё StakeHistory, для DelegateStake ещё StakeConfig). Ledger понятно показывает только этот порядок. С новым порядком без sysvar он требует слепую подпись, а для AuthorizeChecked с хранителем показывает не те ключи. SetLockup, SetLockupChecked и Split в обоих порядках одинаковы. Программа в сети принимает оба варианта.

Это расходится с CLAUDE.md §4 («Sysvar-аккаунтов нет»). Инспектор (шаг 2) принимает только наши форматы. Порядок в сети подтверждает проверка механизма на шаге 1.

## D2. Набор инструментов (02.10.2026)

- TypeScript 6.0.3. TS 7 — нативный компилятор, typescript-eslint 8.71.0 с ним падает (`typescript-eslint does not support TS 7.0`).
- Vitest 4.1.11 во всех пакетах: `@cloudflare/vitest-pool-workers` 0.22.0 требует `vitest ^4.1`.
- Роутер wouter 3.13.0 вместо react-router 8: в сборке +2,4 КБ gzip против +14,4 КБ, нужные функции есть (`useParams`, `useSearchParams`, memory location для тестов). Ставим на шаге 3, когда появятся маршруты.
- pnpm 12.8.1 через `packageManager`, Node 24 (`engines: >=24.15.0`, этого требует jsdom 30).
- В tsconfig включены `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. `baseUrl` TS 6 не принимает, поэтому алиас `@/` задан только через `paths`, а Vite читает его сам (`resolve.tsconfigPaths: true`).

## D3. CSP и Radix (02.10.2026)

Оставляем Radix (shadcn, база radix) и строгую CSP из §11 без послаблений. Не используем примитивы Radix, которые вставляют элемент `<style>`: Dialog, AlertDialog, Select, Sheet, модальные Popover и DropdownMenu (их блокирует `style-src 'self'`, ломается блокировка прокрутки). Модальные окна делаем на нативном `<dialog>`. Действует с шага 3.

## D4. Стейк-программа в тестах LiteSVM (02.10.2026)

LiteSVM 1.5.0 содержит стейк-программу v5.0.0, а в mainnet и devnet работает v5.1.0. Тесты загружают сборку v5.1.0, она побайтно совпадает с релизом на GitHub и с программой в mainnet: sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`, 212 056 байт. Файл кладётся в репозиторий как тестовая фикстура на шаге 1.

## D5. Lighthouse от Phantom и Ledger (02.10.2026)

Ledger отказывается разбирать транзакцию, если в ней есть незнакомая ему программа. Значит, хвост Lighthouse, который дописывает Phantom, переводит Ledger в слепую подпись. Насколько это бьёт по пользователям Ledger через Phantom, меряем в матрице кошельков на шаге 3.

## D6. RPC: всегда base64 (02.10.2026)

В каждом запросе явно передаём `encoding: 'base64'`. Публичные узлы отклоняют кодировку по умолчанию (base58) для 200-байтных аккаунтов: getProgramAccounts отвечает `-32602`, getAccountInfo — `-32600`.

## D7. Минимальная делегация 1 SOL (02.10.2026)

Минимум делегации 1 SOL в mainnet, devnet и LiteSVM. Для проверки механизма на devnet и для scripts/dev-accounts.ts нужно от 3 SOL на devnet.

## D8. Скрипты запускаются обычным Node 24 (02.10.2026)

`node check-rpc.ts` работает без tsx: Node 24 сам вырезает типы. Импорт `@stakeward/core` тоже работает, потому что pnpm кладёт пакет симлинком, его настоящий путь вне `node_modules`. Условия: только стираемый синтаксис и `.ts` в относительных импортах, это проверяют `erasableSyntaxOnly` и `allowImportingTsExtensions`. На одну зависимость меньше.

## D9. Воркер и wrangler (02.10.2026)

- Окружения `dev` (devnet, воркер `stakeward-dev`) и `prod` (mainnet, воркер `stakeward-prod`). У каждого своя база D1. `database_id` в wrangler.jsonc — заглушки, их заменяет владелец после `wrangler d1 create stakeward-dev` и `wrangler d1 create stakeward-prod`.
- Верхний уровень wrangler.jsonc — только локальные значения по умолчанию (`CLUSTER=devnet`, база `stakeward-local` с нулевым id). Без них `wrangler types` делает `env.DB` и `env.CLUSTER` необязательными. Деплой без `--env` упадёт на несуществующей базе, так и задумано.
- `compatibility_date` = 2026-08-15. Пул тестов (vitest-pool-workers 0.22.0) везёт свой workerd, а тот понимает даты не новее 2026-08-22. Поднимать дату вместе с пулом.
- Секреты (`RPC_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_CHAT_ID`) описаны в комментарии wrangler.jsonc, но пока не объявлены в `secrets.required`: с этим полем первый деплой нового воркера падает, если секреты не заданы. Объявим, когда код начнёт их читать.
- Cron появится на шаге 5.
- Воркер зависит от `@stakeward/web` (workspace, dev): так `pnpm -r build` собирает сайт раньше воркера, а `wrangler deploy --dry-run` требует готовый `apps/web/dist`.
- `worker-configuration.d.ts` (типы из `wrangler types`, 612 КБ) лежит в репозитории, CI проверяет его свежесть через `wrangler types --check`.

## D10. Заголовки безопасности (02.10.2026)

Для статики заголовки задаёт `apps/web/public/_headers`, для `/api/*` — `secureHeaders` из Hono с теми же значениями. Тест воркера читает `_headers` и сверяет каждое значение с ответом API, так что разъехаться им не дадут. CSP ровно из §11, с `style-src 'self'`. У API остаются и остальные заголовки Hono по умолчанию (Cross-Origin-Opener/Resource-Policy, X-DNS-Prefetch-Control и др.), `X-Frame-Options` выставлен в `DENY` под `frame-ancestors 'none'`. Локальная проверка через `wrangler dev`: `/`, `/app` и отсутствующий `/assets/missing.js` отдают index.html со всеми четырьмя заголовками, `/api/health` и `/api/nope` — JSON с заголовками из Hono.

## D11. pnpm: сборки, возраст пакетов, audit (02.10.2026)

- `allowBuilds: { esbuild, workerd }` в pnpm-workspace.yaml: pnpm 12 по умолчанию запрещает install-скрипты, а этим двум пакетам нужен postinstall.
- `minimumReleaseAge` оставили по умолчанию (1 день). Пакеты моложе суток pnpm сам дописывает в `minimumReleaseAgeExclude`; этот список коммитим.
- `pnpm audit` на чистой установке нашёл 11 уязвимостей (3 high) в undici 7.29.0 и sharp 0.35.2. Оба пришли через `@cloudflare/vitest-pool-workers` (он закрепил старые miniflare и wrangler 4.124.0), то есть только в тестовой цепочке. Закрыли патч-версиями через `overrides`: `undici@<7.29.1 → 7.29.1`, `sharp@<0.35.4 → 0.35.4`. После этого `No known vulnerabilities found`, тесты воркера проходят. Убрать overrides, когда выйдет новый pool-workers.

## D12. GitHub Actions (02.10.2026)

Действия закреплены по SHA: checkout v7.0.1 `3d3c42e5…`, pnpm/action-setup v6.1.0 `ea17c68d…` (версия pnpm берётся из `packageManager`), setup-node v7.0.0 `82076278…` с кэшем pnpm. Шаги: установка с frozen lockfile, audit, `wrangler types --check`, typecheck, lint, test, build. Playwright добавится на шаге 3.

## Проверка RPC (02.10.2026)

Команда: `pnpm check-rpc <url> [withdrawer]` (или `RPC_URL=<url> pnpm check-rpc`). Скрипт определяет кластер по genesis hash, делает три раза getProgramAccounts по стейк-программе с фильтрами `dataSize 200` + `memcmp` по смещению 44 (withdrawer), `encoding base64`, `dataSlice {0,0}`, затем тот же запрос с полными данными и getMultipleAccounts по найденным адресам, декодирует аккаунты и сверяет withdrawer. Query-строку URL (там ключ Helius) не печатает.

| узел | withdrawer | gPA dataSlice{0,0}, 3 прогона | gPA полные данные | getMultipleAccounts | getGenesisHash |
|---|---|---|---|---|---|
| api.devnet.solana.com | 63rAwzgKQ7P5CSHVtQi6Gasu3wVKhChmzxA2H2A5ssRD | 4 аккаунта: 34, 42, 56 мс | 4, 75 мс | 4/4, все с этим withdrawer, 75 мс | 102 мс |
| api.mainnet-beta.solana.com | 57RQ3ocAibVdC3n3S9i4gT39EpF4DhRCbqAivyg6wtQ6 | 6 аккаунтов: 45, 37, 40 мс | 6, 38 мс | 6/6, все с этим withdrawer, 36 мс | 159 мс |

Замерено с машины разработки. Публичные узлы, бесплатный уровень (`x-ratelimit-method-limit: 10` на getProgramAccounts). Для prod они не годятся, нужен Helius.

**Проверка Helius ждёт ключа.** Команды для владельца (ключ не попадает в вывод):

```sh
pnpm check-rpc "https://devnet.helius-rpc.com/?api-key=$HELIUS_KEY"
pnpm check-rpc "https://mainnet.helius-rpc.com/?api-key=$HELIUS_KEY"
```

Результат дописать в таблицу выше.

## Зависимости

Версии точные, без `^` и `~` (`savePrefix: ''`).

| пакет | версия | где | зачем |
|---|---|---|---|
| typescript | 6.0.3 | корень и каждый пакет | проверка типов; в корне с первого дня, иначе у `@solana/*` пересобирается виртуальное хранилище pnpm (опциональный peer) |
| eslint | 10.11.0 | корень | линтер |
| @eslint/js | 10.0.1 | корень | базовые правила ESLint |
| typescript-eslint | 8.71.0 | корень | правила с учётом типов (`strictTypeChecked`) |
| eslint-plugin-react-hooks | 7.1.1 | корень | правила хуков React для apps/web |
| globals | 17.13.0 | корень | глобальные переменные браузера и Node для ESLint |
| @types/node | 24.19.1 | корень, scripts | типы Node для конфигов vitest и скриптов |
| @solana/kit | 8.4.0 | core, scripts | транзакции, адреса, кодеки, RPC-клиент |
| @solana-program/stake | 0.10.0 | core, scripts | сгенерированный клиент стейк-программы: сборщики, декодер, разбор инструкций |
| @solana-program/system | 0.15.0 | core | nonce-инструкции и создание аккаунтов |
| @solana-program/compute-budget | 0.19.0 | core | инструкции Compute Budget в нужном порядке (хелперы kit дописывают их в конец) |
| litesvm | 1.5.0 | core (dev) | локальная SVM для тестов со стейк-программой; нативный модуль, Windows не поддерживает |
| @solana/kit-plugin-litesvm | 0.19.0 | core (dev) | RPC поверх LiteSVM (`createRpcFromSvm`) и перевод ошибок LiteSVM в `SolanaError` |
| vitest | 4.1.11 | core, web, worker | тесты |
| react, react-dom | 19.3.0 | web | интерфейс |
| @types/react, @types/react-dom | 19.3.0 | web (dev) | типы React |
| vite | 8.3.2 | web (dev) | сборка сайта |
| @vitejs/plugin-react | 6.1.1 | web (dev) | JSX и React в Vite |
| tailwindcss, @tailwindcss/vite | 4.3.3 | web (dev) | стили (CLAUDE.md §3) |
| jsdom | 30.1.1 | web (dev) | DOM для тестов компонентов |
| @testing-library/react | 16.3.3 | web (dev) | рендер компонентов в тестах |
| @testing-library/dom | 10.4.2 | web (dev) | обязательный peer для @testing-library/react 16 |
| @testing-library/jest-dom | 7.0.1 | web (dev) | матчеры `toBeInTheDocument` и др. |
| hono | 4.13.12 | worker | маршруты API и заголовки безопасности |
| wrangler | 4.146.0 | worker (dev) | локальный запуск, типы, миграции D1, деплой |
| @cloudflare/vitest-pool-workers | 0.22.0 | worker (dev) | тесты воркера в workerd с локальной D1 |
