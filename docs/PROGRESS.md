# Прогресс

## Состояние на 02.10.2026

| Шаг | Состояние | Что ждёт владельца |
| --- | --- | --- |
| 0. Подготовка | код готов, CI настроен | `wrangler login`, базы D1, домен, деплой заглушки, ключ Helius, проверить CI на GitHub |
| 1. Проверка механизма | LiteSVM: 24 из 24 | пополнить devnet-спонсора и mainnet-ключ, запустить `pnpm gate:devnet` и `pnpm gate:mainnet` |
| 2. packages/core | готово, 498 тестов | — |
| 3. Каркас, дизайн-система, кошельки | код готов локально, в dev не развёрнут | деплой в dev, `pnpm dev-accounts`, матрица кошельков на /dev/cosign, утвердить /dev/ui и запустить /design-sync, проверка домена в Phantom, решение по CPU (Workers Paid) |

Работа идёт в ветке `build/base`.

## Шаг 0. Подготовка

### Сделано

- Монорепозиторий pnpm 12.8.1 (Node 24): `packages/core`, `apps/web`, `apps/worker`, `scripts`. Общий строгий tsconfig, ESLint 10 с typescript-eslint (`strictTypeChecked`), правила хуков React и запрет `dangerouslySetInnerHTML` для сайта. Команды в корне: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm check-rpc`, `pnpm deploy:dev`, `pnpm deploy:prod`, `pnpm gate:litesvm|devnet|mainnet`.
- `apps/web`: Vite 8 + React 19 + Tailwind 4, страница-заглушка (Stakeward, описание, Coming soon, подвал со ссылкой на исходный код и «No warranty. MIT license.»). `public/_headers` с заголовками безопасности из §11.
- `apps/worker`: один воркер на Hono. Отдаёт `apps/web/dist` как статику с SPA-фолбэком, `/api/*` идёт сначала в воркер. `GET /api/health` пока отвечает `{ ok: true, lastMonitorRunAt: null }`. Заголовки безопасности на всех ответах API. Окружения `dev` (devnet) и `prod` (mainnet) в wrangler.jsonc, D1 `DB` с заглушками id, миграция `0001_init.sql` со схемой из §8.
- `scripts/check-rpc.ts`: живая проверка getProgramAccounts + getMultipleAccounts. Прогнал на публичных devnet и mainnet, результаты в DECISIONS.md.
- GitHub Actions `.github/workflows/ci.yml`: frozen lockfile, audit, свежесть типов воркера, typecheck, lint, test, build.
- LICENSE (MIT), README-заглушка, .gitignore для `.dev.vars*`, `.keys/`, `.env*` и выходных папок.

### Чем проверено

На чистой установке (`pnpm install --frozen-lockfile`, `CI=true`) с кодом 0 прошли `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm audit`, `wrangler types --check`, `wrangler d1 migrations apply DB --local --env dev`. `wrangler dev --env dev` + curl: `/`, `/app` отдают index.html с заголовками безопасности; `/api/health` — 200 JSON с теми же заголовками. Ветка отправлена на GitHub; статус Actions надо посмотреть на сайте GitHub (репозиторий приватный, у агента нет доступа к API).

### Дальше (владелец)

1. `pnpm exec wrangler login` (в `apps/worker`), затем `wrangler d1 create stakeward-dev` и `wrangler d1 create stakeward-prod`, вписать id в `apps/worker/wrangler.jsonc` вместо заглушек.
2. `pnpm --filter @stakeward/worker db:migrate:dev` и `db:migrate:prod`.
3. Подключить постоянный домен: раскомментировать `routes` в окружении `prod`, затем `pnpm deploy:prod` и `pnpm deploy:dev`. Проверить `curl -I https://<домен>/`.
4. Получить ключ Helius и прогнать две команды из раздела «Проверка RPC» в DECISIONS.md.
5. Проверить, что GitHub Actions на ветке `build/base` зелёные.

### Открытые вопросы

- Секреты воркера пока не объявлены обязательными (D9); объявить, когда код начнёт их читать. На шаге 3 `RPC_URL` объявлен (D40).
- `compatibility_date` ограничен 2026-08-22, пока vitest-pool-workers 0.22.0 везёт старый workerd; overrides для undici и sharp убрать с его обновлением.

## Шаг 1. Проверка механизма

### Сделано

- `scripts/gate.ts` и `scripts/gate/`: проверки 1–14 из CLAUDE.md как `runGate(chain, { cluster, keys })` с адаптерами LiteSVM и RPC (D21). Проверки собирают транзакции сборщиками из `@stakeward/core`, то есть в сети проверяются ровно те байты, которые отправит продукт, в legacy-порядке аккаунтов для Ledger (D1). Каждый прогон переписывает свой раздел docs/gate.md.
- LiteSVM: 24 из 24 шагов совпали с ожиданием. Главное утверждение, проверка 2, подтверждено.
- Тесты в CI: `scripts/gate/gate.test.ts` прогоняет планы LiteSVM, devnet и mainnet на LiteSVM ровно на рассчитанную сумму, в том числе с обрывом сети посередине; `scripts/gate/rpc.test.ts` проверяет RPC-адаптер на подставном транспорте.
- Стейк-программа в devnet и mainnet прочитана из programdata: sha256 ELF совпадает с релизом v5.1.0 и с фикстурой тестов.
- Ключи созданы, оба пустые: спонсор devnet `.keys/devnet-funder.json` (`D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL`) и одноразовый ключ mainnet `.keys/mainnet-gate.json` (`7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v`).

### Чем проверено

`pnpm gate:litesvm` — 24 из 24. `pnpm gate:devnet` и `pnpm gate:mainnet` без денег показывают адрес и точную сумму и выходят с кодом 0.

### Дальше (владелец)

- Пополнить спонсора devnet минимум на 1,01058496 SOL (faucet.solana.com) и запустить `pnpm gate:devnet`. Airdrop отсюда не работает: публичный faucet даёт один раз в сутки на IP.
- Перевести 0,02 SOL на одноразовый ключ mainnet и запустить `pnpm gate:mainnet`.
- Эти два прогона подтвердят в сети legacy-порядок аккаунтов для Ledger (D1).

### Открытые вопросы

- CLAUDE.md §2 называет залог nonce-аккаунта около 0,0015 SOL, в сети сейчас 0,00106 SOL (D22).

## Шаг 2. packages/core

Шаг 2 начат до подтверждения шага 1 владельцем: ядро не зависит от прогонов devnet и mainnet, а механизм подтверждён на LiteSVM с mainnet-сборкой программы.

### Сделано

- `constants.ts`, `decode.ts` (через сгенерированный декодер, с проверкой владельца и размера), `lockup.ts` (правила замка, сроки, проверка второго ключа), `status.ts` (статус по эпохам, статус сканера, D14, D27), `format.ts` (дата UTC, короткий адрес, SOL).
- `actions.ts` + `builders.ts` + `legacy-layout.ts`: `buildTransaction` для protect, extend, unlock, withdraw, deactivate, delegate, rescue, nonce setup и nonce close (D1, D17–D20).
- `inspect.ts`: `inspectTransaction(bytes)` принимает только формат сборщиков и проверяет себя контрольной пересборкой (D23).
- `verify.ts`: `checkSigningStep` после каждой подписи и `verifyAllSignatures` перед отправкой (D24).
- `diff.ts`: `diffSnapshots`, `snapshotOf`, тексты тревог и напоминаний (D25).
- `errors.ts`: `translateError` (D26). `link.ts`: фрагмент `/cosign#tx=`.
- Независимое ревью тремя агентами (обход инспектора, обход проверки подписей, соответствие спецификации): 18 находок средней и низкой тяжести; все воспроизведены тестами, 16 исправлены, по 2 исправлена основная часть. Тесты ревью оставлены как регрессионные (`*.review.test.ts`).

### Чем проверено

- `pnpm test`: core 454 теста, scripts 14, web 1, worker 6. `pnpm typecheck`, `pnpm lint` — без ошибок. `pnpm gate:litesvm` — 24 из 24.
- Покрыто «Готово, когда» шага 2: декодирование трёх аккаунтов mainnet; каждый сборщик выполняется на LiteSVM, проверки шага 1 идут в CI; для каждого вида транзакции сводка инспектора совпадает с входом сборщика; инспектор отклоняет чужую программу, таблицу адресов, Split, перевод System, две стейк-инструкции над разными аккаунтами и Lighthouse не в конце; проверка подписи принимает неизменённое сообщение и хвост Lighthouse после первой подписи и отклоняет остальное; сравнение снимков выдаёт каждое событие ровно один раз и молчит на неизменённом аккаунте.

### Открытые вопросы

- Как Phantom дописывает хвост Lighthouse и сколько в нём аккаунтов: матрица кошельков (D5, D24).
- Время CPU инспектора в workerd (D23).
- Откуда брать известные вторые ключи для `scannerStatus` на `/app?address=` без кошелька (D14): решается на шаге 3.

## Шаг 3. Каркас, дизайн-система, проверка кошельков

### Сделано

- Воркер: `/api/rpc` (белый список методов, строгие схемы zod, отправка только после инспектора и проверки подписей), `/api/stake-accounts` (gPA по withdrawer или custodian, кэш 30 с), `/api/health` с полем `now`. Лимиты частоты по IP, тело до 32 КиБ, заголовки безопасности на всех ответах (D38–D40).
- Дизайн-система: tokens.css со светлой и тёмной темой и проверкой контраста AA, 13 компонентов shadcn на токенах, компоненты продукта (StatusBadge, AccountRow, AddressText, SolAmount, WalletSlot, TransactionSummary, StepProgress, Countdown, RiskNote, EmptyState, ErrorState, ActivationBadge), страница /dev/ui. ESLint ловит всё, что ломает CSP (D28, D29).
- Каркас сайта: маршруты всех путей §9 (заглушки, кроме `/`, `/app`, `/dev/ui`, `/dev/cosign`), en.json с типизированной `t()`, кластер задаётся при сборке, код /dev и тестовые двойники не попадают в mainnet (D30, D31).
- Порты: HttpChain поверх своего JSON-RPC транспорта, ожидание подтверждения, WalletPort на Wallet Standard с очередью запросов и отменой, слоты ролей, память F6. Двойники: LiteSvmChain и TestWalletPort (D32–D35, D37).
- Страница /app: по адресу без кошелька или по подключённому Main key; статусы, итоги, «You are the second key for», баннер F6, «Last checked N min ago», загрузка, ошибка с Details, пустое состояние (D36).
- /dev/cosign: два кошелька подписывают один SetLockupChecked по блокхэшу или nonce в обоих порядках, страница показывает, что кошелёк поменял, и пишет отчёт для матрицы (D44).
- `scripts/dev-accounts.ts`: делегированный и неделегированный стейк-аккаунт на devnet для заданного адреса (D43).
- CPU в workerd: тёплый путь спасения 1,4–1,8 мс вместо 3,9–4,4, gPA на 100 аккаунтов 6,3–6,9 мс вместо 9,5–11,4 (D41).
- Playwright под настоящей CSP, axe в обеих темах, ширина 1280 и 360, отдельная задача в CI (D45). Снимки в `docs/screens`: dev-ui, app-empty, app-accounts, dev-cosign.
- Ревью тремя агентами (безопасность, UX и спецификация, корректность): 17 разных находок, 7 средних, остальные низкие. Все исправлены, у каждой есть тест, который падал до исправления. Главная: вариант «Protected без подтверждённого второго ключа» откачен к D14 (D35).

### Чем проверено

- `CI=true pnpm install --frozen-lockfile` — lockfile актуален; `pnpm typecheck` и `pnpm lint` — без ошибок.
- `pnpm test`: core 498, scripts 27, web 239, worker 156 — все прошли (перепроверено 02.10.2026).
- `pnpm build` — ok, `wrangler deploy --dry-run` 582,57 КиБ (gzip 114,92 КиБ); `pnpm --filter @stakeward/web build:mainnet` — ok.
- `pnpm e2e` (локально с `LD_LIBRARY_PATH` от `scripts/playwright-local-libs.sh`) — 20 из 20.
- `pnpm gate:litesvm` — 24 из 24. `pnpm audit` — No known vulnerabilities found.
- «Готово, когда» шага 3:
  - тесты воркера (`apps/worker/test/rpc.test.ts`, `kit-client.test.ts`) показывают, что /api/rpc отклоняет метод вне списка, неверные параметры и транзакцию, которую не принял инспектор;
  - `apps/web/test/app-page.test.tsx` проходит страницу аккаунтов на LiteSvmChain с настоящими стейк-аккаунтами;
  - `e2e/dev-ui.spec.ts` открывает /dev/ui на 1280 и 360 без ошибок в консоли и без нарушений axe;
  - `test/design-tokens.test.ts` не находит сырых цветов вне tokens.css;
  - «развёрнуто в dev» ждёт владельца.

### Дальше (владелец)

Пошагово — в docs/TESTPLAN.md, раздел «Шаг 3».
1. Первый деплой в dev: база D1, миграции, `RPC_URL` от Helius, деплой с `--secrets-file`.
2. Пополнить devnet-спонсора и запустить `pnpm dev-accounts <адрес Main key>`.
3. Матрица кошельков на /dev/cosign, отчёты прислать в чат. После этого я записываю итог в DECISIONS.md и правлю порядок подписей и список поддерживаемых пар (D5, D24).
4. Посмотреть /dev/ui на 1280 и 360, утвердить, запустить /design-sync.
5. Проверка домена в Phantom, если предупреждение о новом домене не уходит.
6. Решить вопрос с CPU (ниже).

### Открытые вопросы

- **CPU: нужно решение владельца (§8, §15).** Бесплатный план даёт 10 мс CPU на запрос. В тёплом изоляте укладываемся: спасение 1,4–1,8 мс, gPA на 100 аккаунтов 6,3–6,9 мс. Первый запрос в свежем изоляте не укладывается: спасение 9–12 мс, gPA на 100 аккаунтов 17–23 мс, время уходит на первую компиляцию кодеков kit. Варианты: Workers Paid за 5 долларов в месяц или остаться на бесплатном и терпеть редкие отказы холодного изолята (браузер повторяет 503, пользователь чаще всего не заметит). По-моему, к mainnet платный план нужен в любом случае: проход мониторинга (§8) читает до 500 аккаунтов, при 0,065 мс на аккаунт это около 33 мс даже в тёплом изоляте.
- У `/api/stake-accounts` нет предела на размер ответа upstream: адрес с десятками тысяч аккаунтов упрётся в CPU и память воркера.
- `secondKeys.remember` пока не вызывается: после перезагрузки второй ключ известен, только пока кошелёк отдаёт его адрес. Шаг 4 запоминает его после защиты (D35).
- Правило плательщика F5 из /dev/cosign перенести в core до шага 6, читатель nonce-аккаунта — до шага 7 (D44).
- `getSignatureStatuses` вызывается без `searchTransactionHistory`; для ожидания по id транзакции на шаге 7 решить, нужен ли он.
- /protect, /extend, /withdraw и /rescue пока заглушки. Их вход задают только ссылки с /app; /protect обязан перечитать аккаунты и сверить withdrawer с подключённым Main key (D36).
- Кэш `/api/stake-accounts` на workers.dev не работает, только на своём домене.
- en.json целиком попадает в mainnet-бандл вместе с текстами /dev/ui и /dev/cosign (только текст).
- Обратный отсчёт Reset на /dev/cosign идёт по часам браузера.
- Хвост Lighthouse, его пересортировку (D24) и поведение настоящих кошельков и Ledger покажет только матрица.
