# Решения

Каждое решение: дата, что решили и почему. Расхождения с CLAUDE.md записываются сюда же.

## D1. Ledger: устаревший порядок аккаунтов (02.10.2026)

Withdraw, AuthorizeChecked, Deactivate и DelegateStake собираем в старом (legacy) порядке аккаунтов: в инструкцию от `@solana-program/stake` 0.10.0 вставляем sysvar-аккаунты (Clock, для Withdraw и DelegateStake ещё StakeHistory, для DelegateStake ещё StakeConfig). Ledger понятно показывает только этот порядок. С новым порядком без sysvar он требует слепую подпись, а для AuthorizeChecked с хранителем показывает не те ключи. SetLockup, SetLockupChecked и Split в обоих порядках одинаковы. Программа в сети принимает оба варианта.

Это расходится с CLAUDE.md §4 («Sysvar-аккаунтов нет»). Инспектор (шаг 2) принимает только наши форматы. Порядок в сети подтверждает проверка механизма на шаге 1.

Подтверждено на LiteSVM с программой v5.1.0 (02.10.2026): все четыре инструкции в старом порядке выполняются (`packages/core/test/builders.svm.test.ts`). Devnet и mainnet подтвердит проверка механизма. Позиции sysvar записаны в `LEGACY_SYSVAR_SLOTS` (`packages/core/src/legacy-layout.ts`), по этой же таблице инспектор проверяет и убирает sysvar перед `parseStakeInstruction`.

## D2. Набор инструментов (02.10.2026)

- TypeScript 6.0.3. TS 7 — нативный компилятор, typescript-eslint 8.71.0 с ним падает (`typescript-eslint does not support TS 7.0`).
- Vitest 4.1.11 во всех пакетах: `@cloudflare/vitest-pool-workers` 0.22.0 требует `vitest ^4.1`.
- Роутер wouter 3.13.0 вместо react-router 8: в сборке +2,4 КБ gzip против +14,4 КБ, нужные функции есть (`useParams`, `useSearchParams`, memory location для тестов). Ставим на шаге 3, когда появятся маршруты.
- pnpm 12.8.1 через `packageManager`, Node 24 (`engines: >=24.15.0`, этого требует jsdom 30).
- В tsconfig включены `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. `baseUrl` TS 6 не принимает, поэтому алиас `@/` задан только через `paths`, а Vite читает его сам (`resolve.tsconfigPaths: true`).

## D3. CSP и Radix (02.10.2026)

Оставляем Radix (shadcn, база radix) и строгую CSP из §11 без послаблений. Не используем примитивы Radix, которые вставляют элемент `<style>`: Dialog, AlertDialog, Select, Sheet, модальные Popover и DropdownMenu (их блокирует `style-src 'self'`, ломается блокировка прокрутки). Модальные окна делаем на нативном `<dialog>`. Действует с шага 3.

## D4. Стейк-программа в тестах LiteSVM (02.10.2026)

LiteSVM 1.5.0 содержит стейк-программу v5.0.0, а в mainnet и devnet работает v5.1.0. Тесты загружают сборку v5.1.0, она побайтно совпадает с релизом на GitHub и с программой в mainnet: sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`, 212 056 байт. Файл лежит в `packages/core/test/fixtures/programs/stake-v5.1.0.so`, рядом README с источником и хешем. 02.10.2026 файл заново скачан с релиза program@v5.1.0 на GitHub, sha256 совпал. Харнесс `test/svm.ts` сверяет хеш перед загрузкой, а тест сравнивает programdata в LiteSVM с файлом.

## D5. Lighthouse от Phantom и Ledger (02.10.2026)

Ledger отказывается разбирать транзакцию, если в ней есть незнакомая ему программа. Значит, хвост Lighthouse, который дописывает Phantom, переводит Ledger в слепую подпись. Насколько это бьёт по пользователям Ledger через Phantom, меряем в матрице кошельков на шаге 3.

## D6. RPC: всегда base64 (02.10.2026)

В каждом запросе явно передаём `encoding: 'base64'`. Публичные узлы отклоняют кодировку по умолчанию (base58) для 200-байтных аккаунтов: getProgramAccounts отвечает `-32602`, getAccountInfo — `-32600`.

## D7. Минимальная делегация 1 SOL (02.10.2026)

Минимум делегации 1 SOL в mainnet, devnet и LiteSVM. Для scripts/dev-accounts.ts нужно от 3 SOL на devnet. Проверке механизма на devnet хватает 1,01058496 SOL (D21): S1 держит ровно минимум делегации, а Split идёт уже по неактивному аккаунту.

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

## D13. Срок замка (02.10.2026)

T считается так. К `now` (UTC) прибавляем N календарных месяцев. Если такого дня в целевом месяце нет, берём последний день месяца: 31 января + 1 месяц = 28 или 29 февраля. Время суток сохраняется. T — первая 00:00 UTC строго после этого момента, то есть начало следующих суток; ровно в полночь тоже переносим на следующую. Сроки 10 минут и 1 час доступны только при `cluster = 'devnet'`: `lockPeriodsFor('mainnet')` их не отдаёт, `lockupEnd` на mainnet бросает ошибку. Кластер передаёт вызывающий, core окружение не читает.

## D14. Статус в сканере (02.10.2026)

По данным сети нельзя понять, чей ключ стоит хранителем. Поэтому `scannerStatus(account, secondKeys, clock)` принимает список вторых ключей, которые известны для этого пользователя: кошелёк в слоте second, хранители, которых он уже подтвердил. Хранитель не из списка — Locked by someone else. Откуда брать список на `/app?address=` без кошелька, решаем на шагах 3–4.

Замок, у которого хранитель — сам withdrawer, считается Unprotected: основной ключ снимает его один, а защита на таком аккаунте работает (A подписывает как хранитель). Замок, который действует только по эпохе, не бывает Expiring. Отдельного параметра `now` нет: текущее время — `clock.unixTimestamp`.

## D15. Проверка типов в core (02.10.2026)

`packages/core/tsconfig.json` проверяет только `src`, без типов Node и DOM: в коде продукта нет ввода-вывода. Тесты и харнесс LiteSVM проверяет отдельный `test/tsconfig.json` с типами Node и библиотекой DOM. DOM нужен потому, что типы подписантов kit ссылаются на глобальный `CryptoKeyPair`, а в @types/node он есть только внутри `webcrypto`. Тестовый кошелёк с ключами в памяти лежит в `packages/core/test/wallet.ts`, код продукта его не импортирует.

## D16. Compute Budget: фиксированные лимит и цена (02.10.2026)

Для всех видов транзакций лимит 60 000 CU и цена 10 000 микролампортов за CU (`COMPUTE_UNIT_LIMIT`, `COMPUTE_UNIT_PRICE_MICRO_LAMPORTS` в `packages/core/src/constants.ts`). Приоритетная комиссия при таком лимите не больше 600 лампортов, на фоне 5000 за подпись это мелочь.

Замер на LiteSVM с программой v5.1.0, вместе с двумя инструкциями Compute Budget (по 150 CU):

| вид | CU |
|---|---|
| protect | 12 022 |
| extend | 8 983 |
| unlock | 8 982 |
| withdraw | 8 652 |
| deactivate | 11 489 |
| delegate | 13 738 |
| rescue на nonce | 25 795 |
| nonce setup | 600 |
| nonce close | 450 |

Лимит в 2,3 раза больше самого тяжёлого вида: остаётся место под хвост Lighthouse, если его допишет Phantom. Тест падает, если какой-то вид тратит больше половины лимита. Цену пересмотрим после матрицы кошельков и первых отправок в mainnet.

## D17. Только legacy-сообщения (02.10.2026)

Все транзакции собираются как legacy-сообщения, не v0. Таблицы адресов запрещены (§2), а без них v0 ничего не даёт и длиннее на 2 байта. Legacy понимают все кошельки и Ledger. Инспектор принимает только legacy.

## D18. Nonce-аккаунт через CreateAccountWithSeed (02.10.2026)

Nonce-аккаунт создаётся инструкцией System CreateAccountWithSeed: base и плательщик — сам D, seed — строка `stakeward-nonce`. Адрес выводится из (D, seed, System program), это делает `deriveNonceAccountAddress`. С обычным CreateAccount новый аккаунт обязан подписать сам, и браузеру пришлось бы генерировать для него одноразовый ключ. С seed подписывает только D, лишних ключей нет.

Ledger показывает пару CreateAccountWithSeed + InitializeNonceAccount так же, как CreateAccount + InitializeNonceAccount: «Create nonce acct» (LedgerHQ/app-solana, `libsol/transaction_printers.c`, `is_create_nonce_account_with_seed`). Seed здесь — метка для вывода адреса, а не ключ и не seed-фраза. У одного D один nonce-аккаунт с этим seed; после закрытия его можно создать снова по тому же адресу. На LiteSVM проверены создание, спасение на этом nonce и закрытие.

## D19. Значения замка в транзакциях (02.10.2026)

Защита (SetLockupChecked) передаёт unixTimestamp = T и epoch = None, то есть «не менять». У обычных аккаунтов epoch замка и так 0, а Ledger без epoch не показывает лишнюю строку. Продление и снятие (SetLockup от K) меняют только unixTimestamp; epoch и custodian передаются как None.

## D20. Один сборщик на все виды транзакций (02.10.2026)

`buildTransaction(action, { feePayer, lifetime })` вместо отдельной функции на каждый вид. `action` (`TransactionAction` в `packages/core/src/actions.ts`) — то же описание, которое вернёт инспектор, поэтому проверка «сводка совпадает с тем, что подали в сборщик» сводится к сравнению объектов. Ключи в сборщике — только адреса (`createNoopSigner`), подписывают кошельки. Плательщика по §5 даёт `expectedFeePayer(action)`; для продления и снятия вызывающий может явно передать основной ключ (F5). Withdraw допускает `secondKey: null` для вывода после снятия или окончания замка. Спасение всегда требует K.

## D21. Проверка механизма: устройство прогона (02.10.2026)

- `runGate(chain, { cluster, keys })` в `scripts/gate/run.ts`, два адаптера: LiteSVM (`gate/litesvm.ts`, поверх харнесса `packages/core/test/svm.ts`) и RPC (`gate/rpc.ts`). RPC-адаптер шлёт транзакцию в base64 без preflight, потом опрашивает getSignatureStatuses до `confirmed` или до истечения блокхэша; на 429, 5xx и обрыв соединения повторяет запрос с паузой. Публичный devnet отвечает 429 уже на опрос раз в секунду.
- Всё, что отправляет и продукт (delegate, protect, withdraw, extend, unlock, deactivate, rescue, создание и закрытие nonce), собирает `buildTransaction` из core. Чего в продукте нет (AuthorizeChecked вора, Split, Merge), гейт собирает в том же формате: лимит и цена CU, одна стейк-инструкция, legacy-сообщение, AuthorizeChecked в legacy-порядке аккаунтов.
- Проверки, которые должны упасть, в devnet и mainnet уходят без preflight: транзакция попадает в блок с ошибкой, и у неё есть подпись в эксплорере. Это стоит одну комиссию.
- S1 делегируется (1b) и снимается с делегирования (7a) в одной эпохе. Такая делегация сразу неактивна, поэтому Split и Merge на шагах 8–9 не упираются в минимум делегации и прогрев, а S1 в конце выводится сразу. На devnet скрипт не стартует, если до конца эпохи меньше 20 минут.
- Стейк-аккаунты создаются через CreateAccountWithSeed от плательщика, seed содержит метку прогона. Одноразовые ключи для аккаунтов не нужны.
- На devnet ключи A, B, X, D генерируются на каждый прогон и сохраняются в `.keys/gate-devnet-{a,b,x,d}.json`; на mainnet в `.keys/mainnet-gate-{b,x}.json`, A — сам одноразовый ключ, D не нужен. В начале прогона скрипт возвращает плательщику всё, что осталось на ключах прошлого прогона; если вернуть не вышло, старые файлы переименовываются, а не затираются. В конце прогона всё, кроме комиссий, возвращается плательщику.
- На mainnet продление и снятие замка оплачивает A, как в F5, когда у K нет SOL. Так ключу B не нужен баланс.
- Сумма пополнения считается точно: залоги за аренду из сети, 1 SOL минимума делегации, комиссия каждой транзакции (5000 лампортов за подпись плюс 600 приоритетной) и остаток, без которого кошелёк не может платить комиссию. План транзакций по плательщикам лежит в `gate/budget.ts`. Тест `scripts/gate/gate.test.ts` прогоняет планы всех трёх кластеров на LiteSVM ровно с этой суммой и проверяет, что в конце у плательщика осталась сумма минус комиссии. Devnet: 1,01058496 SOL, из них комиссии 0,0002624. Mainnet: 0,00238128 SOL, комиссии 0,0000648.
- Харнесс core отдаёт скриптам `@stakeward/core/test/svm`, `test/wallet` и `test/support`. В `test/support.ts` нет LiteSVM: там фикстура программы и перевод `SolanaError` в данные с именами ошибок рантайма, им пользуются и харнесс, и RPC-адаптер.

## D22. Аренда в mainnet и devnet: 5080 лампортов за байт (02.10.2026)

Rent sysvar в mainnet и devnet отдаёт `lamportsPerByte` 5080 (порог освобождения от аренды уже учтён). Минимум без аренды: кошелёк 650 240 лампортов, nonce-аккаунт 1 056 640 (около 0,00106 SOL, а не 0,0015, как в CLAUDE.md §2), стейк-аккаунт 1 666 240. Старые аккаунты хранят прежний `rent_exempt_reserve` 2 282 880. LiteSVM 1.5.0 по умолчанию считает 6960 за байт, харнесс `TestChain` ставит 5080, чтобы тесты шли с той же арендой, что и сеть. Залог на экранах и в FAQ берём из сети (getMinimumBalanceForRentExemption), а не константой.

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
| @types/node | 24.19.1 | корень, scripts, core (dev) | типы Node для конфигов vitest, скриптов и тестов core |
| @solana/kit | 8.4.0 | core, scripts | транзакции, адреса, кодеки, RPC-клиент |
| @solana-program/stake | 0.10.0 | core, scripts | сгенерированный клиент стейк-программы: сборщики, декодер, разбор инструкций |
| @solana-program/system | 0.15.0 | core, scripts | nonce-инструкции и создание аккаунтов; в scripts — подготовка аккаунтов и переводы в проверке механизма |
| @solana-program/compute-budget | 0.19.0 | core, scripts | инструкции Compute Budget в нужном порядке (хелперы kit дописывают их в конец); в scripts — тот же формат для транзакций, которых нет в продукте |
| litesvm | 1.5.0 | core (dev) | локальная SVM для тестов со стейк-программой; нативный модуль, Windows не поддерживает |
| @solana/kit-plugin-litesvm | 0.19.0 | core (dev) | RPC поверх LiteSVM (`createRpcFromSvm`) и перевод ошибок LiteSVM в `SolanaError` |
| vitest | 4.1.11 | core, web, worker, scripts | тесты; в scripts — проверка механизма на LiteSVM в CI |
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
