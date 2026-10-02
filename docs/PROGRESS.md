# Прогресс

## Шаг 0. Подготовка (02.10.2026)

### Сделано

- Монорепозиторий pnpm 12.8.1 (Node 24): `packages/core`, `apps/web`, `apps/worker`, `scripts`. Общий строгий tsconfig, ESLint 10 с typescript-eslint (`strictTypeChecked`), правила хуков React и запрет `dangerouslySetInnerHTML` для сайта. Команды в корне: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check-rpc`, `pnpm deploy:dev`, `pnpm deploy:prod`. `gate:litesvm`, `gate:devnet`, `gate:mainnet` пока заглушки, которые завершаются с ошибкой (шаг 1).
- `packages/core`: зависимости kit 8.4.0 и клиенты stake/system/compute-budget, отдаёт исходники TS без сборки. Пока только константы раскладки стейк-аккаунта для фильтров getProgramAccounts (размер 200, смещения 12/44/92). Тест сверяет смещения с кодировщиком `@solana-program/stake`, второй тест проверяет, что LiteSVM грузится и в нём есть стейк-программа.
- `apps/web`: Vite 8 + React 19 + Tailwind 4, страница-заглушка (Stakeward, описание, Coming soon, подвал со ссылкой на исходный код и «No warranty. MIT license.»). Внешних шрифтов и inline-скриптов нет. `public/_headers` с заголовками безопасности из §11.
- `apps/worker`: один воркер на Hono. Отдаёт `apps/web/dist` как статику с SPA-фолбэком, `/api/*` идёт сначала в воркер. `GET /api/health` пока отвечает `{ ok: true, lastMonitorRunAt: null }`, неизвестные `/api/*` — JSON 404. Заголовки безопасности на всех ответах API. Окружения `dev` (devnet) и `prod` (mainnet) в wrangler.jsonc, D1 `DB` с заглушками id, миграция `0001_init.sql` со схемой из §8.
- `scripts/check-rpc.ts`: живая проверка getProgramAccounts + getMultipleAccounts. Прогнал на публичных devnet и mainnet, результаты в DECISIONS.md.
- GitHub Actions `.github/workflows/ci.yml`: frozen lockfile, audit, свежесть типов воркера, typecheck, lint, test, build.
- LICENSE (MIT), README-заглушка, .gitignore для `.dev.vars*`, `.keys/`, `.env*` и выходных папок.
- docs/DECISIONS.md: D1–D12, проверка RPC, зачем каждая зависимость.

### Чем проверено

На чистой установке (`rm -rf node_modules && pnpm install --frozen-lockfile`, `CI=true`) все команды завершились с кодом 0:

- `pnpm typecheck` — 4 пакета плюс корневой tsconfig;
- `pnpm lint` — без замечаний;
- `pnpm test` — core 3 теста, web 1, worker 6 (здоровье API и заголовки, JSON 404, совпадение `_headers` с заголовками API, миграции D1 и ключи UNIQUE);
- `pnpm build` — сайт собран, `wrangler deploy --dry-run --env dev` собрал воркер (64,56 КиБ, gzip 16,32 КиБ);
- `pnpm audit` — `No known vulnerabilities found` (после overrides для undici и sharp, см. D11);
- `wrangler types --check` — типы актуальны;
- `wrangler d1 migrations apply DB --local --env dev` — `0001_init.sql ✅`;
- `wrangler dev --env dev` + curl: `/`, `/app`, `/assets/missing.js` отдают index.html с CSP, Referrer-Policy, X-Content-Type-Options и Strict-Transport-Security; `/api/health` — 200 JSON с теми же заголовками; `/api/nope` — 404 JSON.

В GitHub Actions ещё не запускалось: push делает владелец.

### Дальше

Владелец:

1. `pnpm exec wrangler login` (в `apps/worker`), затем `wrangler d1 create stakeward-dev` и `wrangler d1 create stakeward-prod`, вписать id в `apps/worker/wrangler.jsonc` вместо заглушек.
2. `pnpm --filter @stakeward/worker db:migrate:dev` и `db:migrate:prod`.
3. Подключить постоянный домен: раскомментировать `routes` в окружении `prod`, затем `pnpm deploy:prod` (и `pnpm deploy:dev`). Проверить `curl -I https://<домен>/`.
4. Получить ключ Helius и прогнать две команды из раздела «Проверка RPC» в DECISIONS.md.
5. Push в GitHub и убедиться, что CI зелёный.

Потом шаг 1: `scripts/gate.ts` на LiteSVM, devnet и mainnet, фикстура стейк-программы v5.1.0 (D4), legacy-порядок аккаунтов (D1).

### Открытые вопросы

- Проверка Helius ждёт ключа (команды в DECISIONS.md).
- Заглушка в prod на постоянном домене не выкачена: нужны `wrangler login`, базы D1 и домен.
- Секреты воркера пока не объявлены обязательными (D9); объявить, когда код начнёт их читать.
- `compatibility_date` ограничен 2026-08-22, пока vitest-pool-workers 0.22.0 везёт старый workerd; overrides для undici и sharp убрать с его обновлением.

## Шаг 2. packages/core: основа (02.10.2026)

Шаг 1 (scripts/gate.ts) ещё не сделан; ядро собрано раньше него, проверки механизма на LiteSVM частично покрыты интеграционными тестами сборщиков.

### Сделано

- `constants.ts`: адреса программ (stake, system, compute budget, Lighthouse), sysvar для legacy-порядка, размеры аккаунтов, смещения для фильтров, `U64_MAX`, лимит и цена Compute Budget (D16).
- `decode.ts`: `decodeStakeAccount` через сгенерированный декодер, с проверкой владельца и размера; результат — `{ ok, account }` или код ошибки.
- `lockup.ts`: `isLockupInForce`, сроки замка (`lockupEndForPeriod`, `lockupEnd`, `lockPeriodsFor`, D13), `validateSecondKey`.
- `status.ts`: `stakeActivationStatus` по эпохам, `scannerStatus` (D14), `groupForViewer`.
- `actions.ts` + `builders.ts` + `legacy-layout.ts`: `buildTransaction` для protect, extend, unlock, withdraw, deactivate, delegate, rescue, nonce setup и nonce close; legacy-сообщение (D17), legacy-порядок аккаунтов (D1), nonce через CreateAccountWithSeed (D18), `expectedFeePayer`, `deriveNonceAccountAddress`.
- `link.ts`: base64url и фрагмент `/cosign#tx=` (строгий разбор). Сделан сразу, а не заглушкой: он нужен тесту спасения.
- Заглушки с типами и описанием для параллельной работы: `inspect.ts`, `verify.ts`, `diff.ts`, `errors.ts`.
- Тестовая обвязка: `test/svm.ts` (LiteSVM с программой v5.1.0, часы, эпохи, vote- и стейк-аккаунты, `send` с разбором ошибок), `test/wallet.ts` (кошелёк с ключом в памяти), фикстуры семи аккаунтов mainnet.

### Чем проверено

- `pnpm --filter @stakeward/core test`: 8 файлов, 138 тестов. Декодирование совпадает с тремя аккаунтами mainnet и с сырыми смещениями §4 у всех семи. Каждый сборщик выполняется на LiteSVM, спасение — на nonce, с подписью по очереди через ссылку.
- `pnpm typecheck`, `pnpm lint` — без ошибок.

### Дальше

Параллельно: инспектор (`inspect.ts`), проверка подписанной транзакции (`verify.ts`), сравнение снимков (`diff.ts`), перевод ошибок (`errors.ts`). Потом шаг 1 (gate) может опираться на `test/svm.ts`.

### Открытые вопросы

- Откуда брать известные вторые ключи для `scannerStatus` на `/app?address=` без кошелька (D14).
- Хватит ли запаса лимита CU под хвост Lighthouse, покажет матрица кошельков (D5, D16).
