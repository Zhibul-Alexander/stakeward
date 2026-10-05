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
  Файл в .gitignore, в репозиторий он не попадёт. С шага 5 воркер требует ещё пять значений (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ADMIN_CHAT_ID`, `TELEGRAM_BOT_USERNAME`, `SITE_ORIGIN`): без них первый деплой не пройдёт. Как их получить — «Шаг 5», пункт а; удобнее сделать это сразу, до первого деплоя. Миграции: `0001`–`0003`.
- [ ] Первый деплой (секрет обязателен, поэтому он идёт из файла):
  ```sh
  pnpm --filter @stakeward/web build:devnet
  cd apps/worker
  pnpm exec wrangler deploy --env dev --secrets-file .dev.vars.dev
  cd ../..
  ```
  Если wrangler попросит выбрать поддомен workers.dev, выбрать любой. Следующие деплои — просто `pnpm deploy:dev`: секрет уже хранится в Cloudflare.
- [ ] Открыть адрес dev: лендинг-заглушка; `/app`, `/dev/ui`, `/dev/cosign` открываются.
- [ ] `curl -s https://stakeward-dev.<поддомен>.workers.dev/api/health` сразу после деплоя отвечает 503 `{"ok":false,"lastMonitorRunAt":null,"now":"…"}`: мониторинг ещё не прошёл ни разу. Через 2–15 минут (cron включается не сразу) — 200 и свежий `lastMonitorRunAt`.
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

## Шаг 4. Защита

Нужно: развёрнутый dev (шаг 3 а), на каждом Main key есть стейк-аккаунты (шаг 3 б) и devnet SOL на комиссии. Второму ключу SOL не нужен.

- [ ] Открыть `<адрес dev>/app`, подключить кошелёк как Main key. У двух аккаунтов статус Not protected. Нажать Protect у одного, затем вернуться и выбрать оба: адрес страницы `/protect?account=…&account=…`.
- [ ] Шаг «Accounts»: оба аккаунта отмечены. Аккаунт чужого ключа из ссылки, если подставить его в адрес руками, попадает в «Left out».
- [ ] Шаг «Second key»: подключить второй кошелёк из другой seed-фразы. Если подключить тот же аккаунт, что Main key, страница откажет и попросит переключить аккаунт. Без галочки «My second key comes from a different seed phrase» Continue не пускает.
- [ ] Шаг «Lock period»: на devnet есть «10 minutes (devnet test)». Выбрать его. Под выбором дата окончания (для 10 минут это сегодняшняя дата, время не показывается) и предупреждение «If you lose the second key, you wait until …».
- [ ] Шаг «Review and sign»: одна карточка «Protect this stake» со списком двух аккаунтов целиком, «Who signs» (Main key платит комиссию), «Network fee», «What this transaction cannot do» и строка «Stakeward never asks for your seed phrase». Нажать «Sign 2 transactions in <кошелёк> as Main key», одобрить в кошельке; потом то же для Second key. Если Phantom участвует, страница может сама попросить его подписать первым.
- [ ] Записать, что показал каждый кошелёк (предупреждения, сколько транзакций в одном окне). Если кошелёк не умеет подписать две транзакции одним запросом, страница предложит «Sign one stake account at a time».
- [ ] Экран «Done»: «2 stake accounts are protected», у каждого ссылка на транзакцию и на карточку восстановления, строка мониторинга, карточка Telegram (ссылка откроет бота после шага 5).
- [ ] На `/app` оба аккаунта «Expiring soon» (замок на 10 минут короче 30 дней; при сроке от месяца было бы «Protected»).
- [ ] В штатном экране стейкинга кошелька попробовать вывести SOL из защищённого аккаунта (сначала Unstake, если он делегирован). Вывод должен упасть с ошибкой про lockup.
- [ ] Через 10 минут обновить `/app`: аккаунты без защиты, красный баннер «… no longer protected» с кнопкой «Protect again».
- [ ] Отказ: начать защиту ещё раз и нажать Reject во втором кошельке. Страница пишет, что ничего не отправлено, и даёт «Try again».
- [ ] Сравнить экраны с макетами, когда появится шаг 3б (или утвердить по скриншотам `docs/screens/protect-*`, `dev-ui-signing-*`, `dev-ui-protect-result-*`).


## Шаг 5. Мониторинг и Telegram

Нужен развёрнутый в dev шаг 4 (мастер защиты).

### а) Боты и секреты
- [ ] В Telegram открыть @BotFather → `/newbot` дважды: «Stakeward Dev» (username, например, `stakeward_dev_bot`) и «Stakeward». Сохранить оба токена.
- [ ] Свой chat id: написать что-нибудь dev-боту, затем `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates"` (до setWebhook) и взять `message.chat.id`.
- [ ] Секрет вебхука на каждое окружение: `openssl rand -hex 32`.
- [ ] Дописать в `apps/worker/.dev.vars.dev` (позже так же `.dev.vars.prod`):
  ```
  TELEGRAM_BOT_TOKEN=<токен dev-бота>
  TELEGRAM_WEBHOOK_SECRET=<секрет>
  ADMIN_CHAT_ID=<ваш chat id>
  TELEGRAM_BOT_USERNAME=<username без @>
  SITE_ORIGIN=https://stakeward-dev.<поддомен>.workers.dev
  ```
- [ ] `pnpm --filter @stakeward/worker db:migrate:dev`: применены `0002_monitor.sql` и `0003_pending_index.sql`.
- [ ] Деплой с секретами:
  ```sh
  pnpm --filter @stakeward/web build:devnet
  cd apps/worker && pnpm exec wrangler deploy --env dev --secrets-file .dev.vars.dev && cd ../..
  ```

### б) Регистрация бота (из корня репозитория)
```sh
set -a; . apps/worker/.dev.vars.dev; set +a
API="https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN"
curl -sS "$API/setWebhook" --data-urlencode "url=$SITE_ORIGIN/api/telegram/webhook" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  --data-urlencode 'allowed_updates=["message","my_chat_member"]' -d drop_pending_updates=true
curl -sS "$API/setMyCommands" -H 'Content-Type: application/json' -d '{"commands":[
  {"command":"start","description":"Alerts for a wallet: /start <address>"},
  {"command":"status","description":"Wallets this chat follows"},
  {"command":"stop","description":"Turn off all alerts in this chat"}]}'
curl -sS "$API/setMyDescription" --data-urlencode "description=Alerts for stake accounts protected with Stakeward. Alerts only link to $SITE_ORIGIN. Stakeward never asks for your seed phrase."
curl -sS "$API/setMyShortDescription" --data-urlencode "short_description=Stakeward alerts. Only $SITE_ORIGIN is Stakeward."
curl -sS "$API/getWebhookInfo"
```
- [ ] В выводе `getWebhookInfo`: верный `url`, `pending_update_count: 0`, нет `last_error_message`.
- [ ] Через 2–4 минуты `curl -i $SITE_ORIGIN/api/health` отвечает 200 со свежим `lastMonitorRunAt`. Cron может включаться до 15 минут после деплоя.

### в) Проверяю я
- [ ] Открыть `<адрес dev>/app?address=<Main key>`, нажать Get alerts in Telegram, в боте нажать Start. Ответ «Alerts are on for …». `/status` показывает кошелёк и число аккаунтов.
- [ ] Защитить devnet-аккаунт мастером шага 4 (срок 1 час).
- [ ] В кошельке снять его с делегирования (Phantom: Unstake). За 2–4 минуты приходит тревога «Stake … was deactivated …» с кнопкой Open Rescue, кнопка открывает адрес dev.
- [ ] Замок вторым ключом: на `/dev/cosign` нажать «Remove the lock with the Second key» или продлить через `solana stake-set-lockup --custodian <файл ключа K> --lockup-date <RFC3339> <STAKE> --url devnet`. Приходит тревога о замке (LOCKUP_CHANGED).
- [ ] `/stop`: следующее изменение приходит без сообщения.
- [ ] По желанию: заблокировать бота, разблокировать, `/status` показывает, что привязок нет.

### г) CPU (решение Free или Paid)
- [ ] Через сутки в Cloudflare: Workers & Pages → stakeward-dev → Observability → Logs. Отфильтровать вызовы cron (scheduled), посмотреть CPU time (поле `$workers.cpuTimeMs`, если имя другое — колонка CPU time). Прислать в чат:
  - максимум за 24 часа;
  - есть ли исходы Exceeded CPU;
  - приходили ли тревоги «the previous pass did not finish».
- [ ] Запасной путь — GraphQL Analytics, набор `workersInvocationsScheduled`, поле `cpuTimeUs`.

## Шаг 8. Карточка восстановления (команды CLI)

- [ ] Пополнить спонсора devnet `D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL` ещё на 1,13 SOL (или на 0,13 SOL для прогона с `--skip-delegated`). Вернётся всё, кроме комиссий (около 0,0004 SOL).
- [ ] Поставить Solana CLI 4.3.0: `sh -c "$(curl -sSfL https://release.anza.xyz/v4.3.0/install)"` (или попросить меня: я запускаю его из своей среды).
- [ ] `pnpm recovery-cli --url devnet --dry-run` печатает план и сумму, ничего не отправляя. Затем `pnpm recovery-cli --url devnet`: все проверки зелёные, раздел devnet в `docs/recovery-cli.md` заполнен ссылками на эксплорер.
- [ ] Прочитать раздел README «Recover without Stakeward» глазами человека, у которого украли ключ.
