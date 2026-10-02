# Ручной тест-план

Пункты «Проверяю я» из шагов сборки. Перед подачей весь список проходится на prod.
Отметка: `- [x]` и дата, или заметка, что пошло не так.

## Шаг 0. Подготовка

- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` проходят на чистом клоне.
- [ ] GitHub Actions зелёные на последнем push.
- [ ] Заглушка prod открывается по постоянному домену, заголовки безопасности на месте (`curl -I https://<домен>/`).
- [ ] Проверка Helius (getProgramAccounts по стейк-программе на devnet и mainnet) записана в docs/DECISIONS.md.

## Шаг 1. Проверка механизма

- [ ] Devnet: спонсор `.keys/devnet-funder.json` (`D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL`) пополнен минимум на 1,01058496 SOL (https://faucet.solana.com), `pnpm gate:devnet` прошёл: 21 из 21 шага совпали, возврат средств завершён.
- [ ] Mainnet: на одноразовый ключ `.keys/mainnet-gate.json` (`7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v`) переведено 0,02 SOL (минимум 0,00238128), `pnpm gate:mainnet` прошёл: 8 из 8 шагов совпали. Остаток выведен: `solana transfer --from .keys/mainnet-gate.json <адрес> ALL --url mainnet-beta`.
- [ ] docs/gate.md прочитан: по каждой проверке есть результат и подпись или код ошибки для LiteSVM, devnet и mainnet.

## Шаг 3. Каркас, дизайн-система, проверка кошельков

Все команды — из корня репозитория, если не сказано иначе. Адрес dev дальше: `https://stakeward-dev.<поддомен>.workers.dev`, его печатает wrangler при деплое.

### а) Первый деплой в dev

- [ ] `cd apps/worker && pnpm exec wrangler login`: откроется браузер, разрешить доступ к аккаунту Cloudflare. Вернуться в корень: `cd ../..`.
- [ ] `cd apps/worker && pnpm exec wrangler d1 create stakeward-dev && cd ../..`. Из вывода скопировать `database_id` и вписать в `apps/worker/wrangler.jsonc`, в `env.dev.d1_databases`, вместо `00000000-0000-0000-0000-000000000001`. Если wrangler предложит сам дописать базу в конфиг, отказаться: id вписывается руками именно в окружение `dev`.
- [ ] `pnpm --filter @stakeward/worker db:migrate:dev`, на вопрос о применении миграции ответить yes. В выводе: `0001_init.sql` применена.
- [ ] В https://dashboard.helius.dev скопировать devnet URL с ключом. Создать файл `apps/worker/.dev.vars.dev` с одной строкой:
  `RPC_URL=https://devnet.helius-rpc.com/?api-key=<ключ>`
  Файл в .gitignore, в репозиторий он не попадёт.
- [ ] Первый деплой (секрет обязателен, поэтому он идёт из файла):
  ```sh
  pnpm --filter @stakeward/web build:devnet
  cd apps/worker
  pnpm exec wrangler deploy --env dev --secrets-file .dev.vars.dev
  cd ../..
  ```
  Если wrangler попросит выбрать поддомен workers.dev, выбрать любой. Следующие деплои — просто `pnpm deploy:dev`: секрет уже хранится в Cloudflare.
- [ ] Открыть адрес dev: лендинг-заглушка; `/app`, `/dev/ui`, `/dev/cosign` открываются.
- [ ] `curl -s https://stakeward-dev.<поддомен>.workers.dev/api/health` отвечает `{"ok":true,"lastMonitorRunAt":null,"now":"…"}`.
- [ ] `curl -sI https://stakeward-dev.<поддомен>.workers.dev/` показывает `content-security-policy`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff`, `strict-transport-security`.
- [ ] RPC через воркер работает:
  ```sh
  curl -s -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getEpochInfo","params":[{"commitment":"confirmed"}]}' \
    https://stakeward-dev.<поддомен>.workers.dev/api/rpc
  ```
  В ответе `result` с `epoch` и `blockHeight`. Если вместо этого 503 «RPC is not configured», секрет не дошёл: повторить деплой с `--secrets-file`.

### б) Тестовые стейк-аккаунты на devnet

- [ ] Пополнить спонсора `D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL` на https://faucet.solana.com. dev-accounts с параметрами по умолчанию нужно 1,10399392 SOL. Если `pnpm gate:devnet` из шага 1 ещё не прогнан, запустить его первым: он возвращает всё, кроме комиссий, и тогда 1,11 SOL хватит на обе команды.
- [ ] Выбрать кошелёк, который будет Main key (например, Phantom), скопировать его адрес. `pnpm dev-accounts <адрес> --dry-run` печатает план и точную сумму, ничего не отправляя.
- [ ] `pnpm dev-accounts <адрес>`: появятся делегированный (1 SOL) и неделегированный (0,1 SOL) стейк-аккаунты этого адреса, без замка. Для каждого следующего кошелька в роли Main key хватит одного аккаунта: `pnpm dev-accounts <адрес> --only undelegated` (около 0,1 SOL).
- [ ] На каждый кошелёк в роли Main key взять 1 SOL с https://faucet.solana.com: из него платятся комиссии и залог nonce-аккаунта (около 0,00106 SOL, возвращается при закрытии). Second key SOL не нужен.
- [ ] Открыть `<адрес dev>/app?address=<адрес Main key>`: два аккаунта со статусом Not protected, строка «Monitoring has not run yet» (мониторинг появится на шаге 5).

### в) Матрица кошельков на /dev/cosign

Подготовка:
- [ ] В каждом кошельке включить devnet. Phantom: Settings → Developer Settings → Testnet Mode, сеть Solana Devnet. Solflare и Backpack: в настройках сети выбрать Devnet.

Пары (Main key / Second key):

| # | Main key | Second key |
|---|---|---|
| 1 | Phantom | Solflare |
| 2 | Phantom | Backpack |
| 3 | Solflare | Backpack |
| 4 | Phantom, аккаунт 1 | Phantom, аккаунт 2 |
| 5–7 | Ledger через Phantom, через Solflare, через Backpack | любой другой кошелёк |

Для пар 5–7 Ledger-аккаунт подключается как Main key: так подписывает владелец крупного стейка. Ему тоже нужны SOL с faucet и свой аккаунт (`pnpm dev-accounts <адрес Ledger> --only undelegated`).

Каждую пару прогнать четыре раза:
- [ ] blockhash, Main key first;
- [ ] blockhash, Second key first;
- [ ] nonce, Main key first;
- [ ] nonce, Second key first.

Один прогон по шагам:
1. Открыть `<адрес dev>/dev/cosign`.
2. «1. Wallets»: «Connect a wallet as Main key», выбрать кошелёк, одобрить подключение. Так же «Connect a wallet as Second key». В паре 4 перед вторым подключением переключить Phantom на аккаунт 2; страница напишет, что оба ключа в одном кошельке, и перед каждой подписью попросит переключить аккаунт.
3. «2. Stake account»: нажать «Use <адрес>» у нужного аккаунта. Пустой список значит, что для этого Main key не запущен `pnpm dev-accounts`.
4. «3. Options»: выбрать «Recent blockhash» или «Durable nonce» и «Main key first» или «Second key first». Для nonce в первый раз нажать «Create nonce account» и подписать в кошельке Main key.
5. «4. Run»: «Start run». Для каждого подписанта нажать «Sign in <кошелёк> as <роль>» и одобрить в кошельке. Блокхэш живёт около минуты, вторую подпись не откладывать. После подписи прочитать строки Change (Unchanged / Lighthouse checks added / Changed in another way) и Check.
6. Когда обе подписи проверены, нажать «Send to devnet» и дождаться «Confirmed on devnet.» и «Lock set: …».
7. «5. Reset»: «Remove the lock with the Second key» и подписать вторым кошельком. Или подождать 10 минут, замок кончится сам. Без этого следующий прогон на этом аккаунте не стартует.
8. Остановка прогона тоже результат: например, `tail-not-first-signer`, когда Phantom дописал Lighthouse, подписывая вторым. Записать и перейти к следующему прогону.

Что записать (в «6. Reports» у каждого отчёта три пустые строки в конце):
- [ ] «Wallet warnings shown:»: точный текст каждого предупреждения кошелька или `none`.
- [ ] «Ledger showed fields (yes/no):»: `yes`, если Ledger показал действие и поля замка (второй ключ, дата); `no`, если просил слепую подпись или показал только хеш. Слепую подпись можно включить в приложении Solana на Ledger, чтобы довести прогон, но в отчёте написать, что она понадобилась.
- [ ] «Notes:»: всё остальное, например, кошелёк не отдал второй аккаунт или путал, какой аккаунт активен.
- [ ] Прошла ли транзакция на nonce, страница пишет сама в строке Send.
- [ ] В конце нажать «Copy all (N)», вставить текст в чат с Claude и дописать три строки к каждому отчёту. По ним я записываю итог в DECISIONS.md и до шага 4 правлю порядок подписей и список поддерживаемых пар.
- [ ] По желанию: «Close nonce account» у каждого Main key возвращает залог.

### г) Внешний вид /dev/ui

- [ ] Открыть `<адрес dev>/dev/ui` на десктопе, ширина окна около 1280.
- [ ] Ширина телефона: Chrome DevTools → Toggle device toolbar → Responsive, ширина 360. Или открыть на телефоне. Горизонтальной прокрутки быть не должно.
- [ ] Тёмная тема: переключить тему системы или DevTools → Rendering → Emulate CSS media feature prefers-color-scheme: dark. Цвета обеих тем страница показывает и сама, в разделе Colours.
- [ ] Пройти разделы: токены, примитивы, компоненты продукта в состояниях обычное, загрузка, пусто, ошибка. Для сравнения есть снимки `docs/screens/dev-ui-1280.png` и `dev-ui-360.png`.
- [ ] Написать в чат «/dev/ui утверждаю» или список правок.
- [ ] После утверждения запустить `/design-sync` в Claude Code в этом репозитории и прислать ссылку на проект в Claude Design: я запишу её в docs/DESIGN.md для шага 3б.

### д) Проверка домена в Phantom

- [ ] Открыть сайт в браузере с Phantom и подключить кошелёк. Если Phantom пишет «This domain is new or has not been reviewed yet. Proceed with caution.», это обычно проходит само за несколько дней.
- [ ] Если предупреждение держится больше недели, отправить домен через форму Phantom: https://docs.google.com/forms/d/1JgIxdmolgh_80xMfQKBKx9-QPC7LRdN6LHpFFW8BlKM/viewform (ссылка со страницы https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings). Главное — постоянный домен prod; адрес на workers.dev стоит отправлять, только если предупреждение мешает матрице.
