# Ручной тест-план

Пункты «Проверяю я» из шагов сборки. Перед подачей весь список проходится на prod.
Отметка: `- [x]` и дата, или заметка, что пошло не так.

## Минимум владельца (06.10.2026)

Только то, что не могу сделать я. Остальное в этом файле — подробности для этих шагов.

1. Доступы, 5 минут: 2FA на Cloudflare, GitHub и аккаунте Telegram, которому принадлежат боты; BotFather `/setjoingroups` → Disable у `@stakeward_dev_bot` и `@stakeward_bot`.
2. Devnet SOL: около 2 SOL с https://faucet.solana.com на спонсора `D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL`. Раздать SOL вашим кошелькам и прогнать команды карточки я смогу сам.
3. Деплой dev, когда я скажу, что сборка готова. В корне репозитория, в новой оболочке:
   ```sh
   pnpm deploy:dev
   ( set -a; . ~/.config/stakeward/secrets.env; set +a
     exec env -i PATH="$PATH" HOME="$HOME" CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
       CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" pnpm --filter @stakeward/worker db:migrate:dev )
   ```
   Написать в чат «задеплоил». Сверку и коммит `docs/deploys.md` делаю я.
4. Один проход на dev с тремя аккаунтами Phantom (Main key, Second key, New wallet), около часа: `/dev/cosign` — 4 прогона и «Copy all» в чат (шаг 3 в); защита на 10 минут (шаг 4); привязать Telegram и снять стейк с делегирования — пришла тревога (шаг 5 в); вывод и продление (шаг 6); спасение на New wallet и подпись по ссылке с телефона (шаг 7). Что сломалось или непонятно — в чат.
5. Mainnet (шаг 9): по моему слову `pnpm deploy:prod --prod-confirm` и та же миграция с `db:migrate:prod`; форма Phantom для адреса prod (шаг 3 д); тот же проход с маленьким своим стейком; уговорить одного-двух человек защитить свой стейк.
6. Подача: раздел бизнеса в `docs/SUBMISSION.md`, питч-видео и демо по сценариям оттуда, заявка на Colosseum до 12.10 23:59 PT.

## Шаг 0. Подготовка

- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` проходят на чистом клоне.
- [ ] GitHub Actions зелёные на последнем push. 05.10.2026: check зелёный, e2e красный на build/product (#9, #10): axe находит недостаточный контраст кнопок на ширине 360, каждый раз разных, часть тестов проходит со второй попытки. 06.10.2026: на a5f563c наоборот — e2e зелёный (контраст один раз упал и на 1280, `/cosign#tx=@@`, прошёл со второй попытки), check красный на `pnpm test`: гонка блокхэша в тестовой подготовке LiteSVM (SECURITY-CHECK П27), исправлено в d0c5e7d; на 40edd82 check зелёный. Контраст в e2e: axe мерил цвета посреди смены темы (DECISIONS D99), исправлено. Для prod нужен зелёный check: без него `pnpm deploy:prod` откажет.
- [x] 05.10.2026: prod открывается на временном адресе https://stakeward-prod.zhibul-alexander.workers.dev (свой домен не куплен, DECISIONS.md «Развёртывание»), заголовки безопасности на месте (`curl -I`).
- [x] 05.10.2026: проверка Helius записана в docs/DECISIONS.md, раздел «Проверка RPC».

## Шаг 1. Проверка механизма

- [x] 05.10.2026, devnet: спонсор `.keys/devnet-funder.json` (`D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL`) пополнен на 5 SOL, `pnpm gate:devnet` через Helius: 21 из 21 шага совпали, возврат средств завершён.
- [x] 05.10.2026, mainnet: на одноразовый ключ `.keys/mainnet-gate.json` (`7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v`) пришли 0,021 SOL (вывод с биржи), `pnpm gate:mainnet`: 8 из 8 шагов совпали. Остаток 0,0209302 SOL переведён на Phantom 1 `KGEtV7dbRrrrQ3QAUs8YzZgAuneu4KNhENRVHRk9XVw`, транзакция `4pZgWtYCsEBpvX2Q1mum2duuF3FUsbz3hYL1mJ3gk4e1Lagk48NopFFk2YwvnEjJnSmdoypH5rp3Y158MjzpuqU2`. Отправителю остаток не возвращаем: при выводе с биржи отправитель — общий кошелёк биржи.
- [ ] docs/gate.md прочитан: по каждой проверке есть результат и подпись или код ошибки для LiteSVM, devnet и mainnet.

## Шаг 3. Каркас, дизайн-система, проверка кошельков

Все команды — из корня репозитория, если не сказано иначе. Адрес dev: https://stakeward-dev.zhibul-alexander.workers.dev.

### а) Первый деплой в dev

Сделано 05.10.2026 по API-токену владельца, вместе с prod: базы D1, миграции 0001–0003, секреты, деплой, вебхуки ботов (DECISIONS.md, «Развёртывание»). Следующие деплои — только `pnpm deploy:dev` из оболочки, куда файл секретов не подключён: обёртка сама берёт из него два ключа Cloudflare (DECISIONS D96). Порядок выкатки и миграций — в разделе «Выкатка новой сборки» в конце.

- [ ] Открыть адрес dev в браузере: лендинг; `/app`, `/dev/ui`, `/dev/cosign` открываются (curl 05.10.2026: все 200).
- [x] 05.10.2026: `/api/health` сразу после деплоя ответил 503 `{"ok":false,"lastMonitorRunAt":null,…}`, после первого прохода в 19:18 UTC — 200.
- [x] 05.10.2026: `curl -sI` показывает `content-security-policy`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff`, `strict-transport-security`.
- [x] 05.10.2026: RPC через воркер работает (getEpochInfo: эпоха 1175), метод вне списка получает -32601.

### б) Тестовые стейк-аккаунты на devnet

- [x] 05.10.2026: спонсор `D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL` пополнен на 5 SOL.
- [x] 05.10.2026: Main key — Phantom 1 `KGEtV7dbRrrrQ3QAUs8YzZgAuneu4KNhENRVHRk9XVw`. `pnpm dev-accounts` создал делегированный `9SV2x3NahSEWTbAizM26q8z5AGdAPCVwtiPtULCmrph2` (1 SOL) и неделегированный `6GqZV9JSD9z6EdfvFYzPr2VaT2Ssrb2P54hdTF5aPkv3` (0,1 SOL), без замка. Second key — Phantom 2 `2Fz9TUpSUQRqDdYMNu2kgxVTc7vy7WQcBt8sHYt2rxyK`.
- [x] 05.10.2026: на Phantom 1 переведено 0,2 SOL со спонсора на комиссии и залог nonce-аккаунта (вместо faucet). Second key SOL не нужен.
- [ ] Открыть `<адрес dev>/app?address=KGEtV7dbRrrrQ3QAUs8YzZgAuneu4KNhENRVHRk9XVw`: два аккаунта со статусом Not protected.

### в) Матрица кошельков на /dev/cosign

Подготовка:
- [ ] В Phantom включить devnet: Settings → Developer Settings → Testnet Mode, сеть Solana Devnet. Режим действует на оба аккаунта.

Пара (Main key / Second key): Phantom 1 / Phantom 2. У владельца нет Ledger и других кошельков (05.10.2026), поэтому Solflare, Backpack и Ledger не проверяются; в FAQ так и пишем: проверен только Phantom. Если кошельки появятся, пары те же, что были: Phantom + Solflare, Phantom + Backpack, Solflare + Backpack, Ledger через каждый из них как Main key (ему нужен свой аккаунт: `pnpm dev-accounts <адрес Ledger> --only undelegated`).

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
- [ ] «Ledger showed fields (yes/no):»: `no Ledger`. С Ledger было бы так: `yes`, если Ledger показал действие и поля замка (второй ключ, дата); `no`, если просил слепую подпись или показал только хеш.
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

- [ ] Открыть https://stakeward-prod.zhibul-alexander.workers.dev в браузере с Phantom и подключить кошелёк. Если Phantom пишет «This domain is new or has not been reviewed yet. Proceed with caution.», в тот же день отправить форму Phantom: https://docs.google.com/forms/d/1JgIxdmolgh_80xMfQKBKx9-QPC7LRdN6LHpFFW8BlKM/viewform (ссылка со страницы https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings). Phantom советует ждать неделю, но первые пользователи придут 10.10, а на workers.dev много фишинга.
- [ ] Поля формы: Project Name — Stakeward; dApp website URL — адрес prod; Transaction Link — шаг 2 mainnet из docs/gate.md (SetLockupChecked); Team Information — https://github.com/Zhibul-Alexander; Repository Links — https://github.com/Zhibul-Alexander/stakeward; Social Media Handles — X или Telegram владельца. Describe your dApp:
  > Stakeward is a free, open-source, non-custodial web app that protects natively staked SOL with the lockup built into the Solana stake program. Users set a second wallet they control as the lockup custodian of their existing stake accounts, so a stolen main key can neither withdraw the stake nor change its withdraw authority. There is no custom on-chain program: transactions contain only Stake program, System nonce and Compute Budget instructions.

## Шаг 4. Защита

Нужно: развёрнутый dev (шаг 3 а), на каждом Main key есть стейк-аккаунты (шаг 3 б) и devnet SOL на комиссии. Второму ключу SOL не нужен.

- [ ] Открыть `<адрес dev>/app`, подключить кошелёк как Main key. У двух аккаунтов статус Not protected. Нажать Protect у одного, затем вернуться и выбрать оба: адрес страницы `/protect?account=…&account=…`.
- [ ] Шаг «Accounts»: оба аккаунта отмечены. Аккаунт чужого ключа из ссылки, если подставить его в адрес руками, попадает в «Left out».
- [ ] Шаг «Second key»: подключить второй кошелёк из другой seed-фразы. Если подключить тот же аккаунт, что Main key, страница откажет и попросит переключить аккаунт. Без галочки «My second key comes from a different seed phrase» Continue не пускает.
- [ ] С парой Phantom 1 / Phantom 2 (один кошелёк) на этом шаге видно предупреждение «Accounts of one wallet app, and every account of one Ledger, usually come from one seed phrase…» и строку «Use your second key only to co-sign Stakeward transactions…».
- [ ] Шаг «Lock period»: на devnet есть «10 minutes (devnet test)». Выбрать его. Под выбором дата окончания (для 10 минут это сегодняшняя дата, время не показывается) и предупреждение «If you lose the second key, you wait until …».
- [ ] Шаг «Review and sign»: одна карточка «Protect this stake» со списком двух аккаунтов целиком, «Who signs» (Main key платит комиссию), «Network fee», «What this transaction cannot do» и строка «Stakeward never asks for your seed phrase». Нажать «Sign 2 transactions in <кошелёк> as Main key», одобрить в кошельке; потом то же для Second key. Если Phantom участвует, страница может сама попросить его подписать первым.
- [ ] Записать, что показал каждый кошелёк (предупреждения, сколько транзакций в одном окне). Если кошелёк не умеет подписать две транзакции одним запросом, страница предложит «Sign one stake account at a time».
- [ ] Экран «Done»: «2 stake accounts are protected», у каждого ссылка на транзакцию и на карточку восстановления, строка мониторинга, карточка Telegram (ссылка откроет бота после шага 5) с датой конца замка и строкой «Without Telegram alerts nobody reminds you before <дата>».
- [ ] На `/app` оба аккаунта «Expiring soon» (замок на 10 минут короче 30 дней; при сроке от месяца было бы «Protected»).
- [ ] В штатном экране стейкинга кошелька попробовать вывести SOL из защищённого аккаунта (сначала Unstake, если он делегирован). Вывод должен упасть с ошибкой про lockup.
- [ ] Через 10 минут обновить `/app`: аккаунты без защиты, красный баннер «… no longer protected» с кнопкой «Protect again».
- [ ] Отказ: начать защиту ещё раз и нажать Reject во втором кошельке. Страница пишет, что ничего не отправлено, и даёт «Try again».
- [ ] По желанию: перевести часы компьютера на 2 дня вперёд и открыть шаг «Lock period»: страница не считает дату, говорит, что время сети и устройства не совпадает, оба времени под Details, есть Try again. Вернуть часы.
- [ ] Сравнить экраны с макетами, когда появится шаг 3б (или утвердить по скриншотам `docs/screens/protect-*`, `dev-ui-signing-*`, `dev-ui-protect-result-*`).


## Шаг 5. Мониторинг и Telegram

Нужен развёрнутый в dev шаг 4 (мастер защиты).

### а) Боты и секреты
- [x] 05.10.2026: боты `@stakeward_dev_bot` и `@stakeward_bot`, chat id владельца (@userinfobot), секреты вебхука, секреты обоих окружений в Cloudflare, миграции 0001–0003 (DECISIONS.md, «Развёртывание»). Файлы секретов окружений: `~/.config/stakeward/dev.vars` и `prod.vars` на VPS.

### б) Регистрация бота (из корня репозитория)
Сделано 05.10.2026 для обоих ботов; команды ниже нужны для повтора, например после смены адреса сайта. Для prod — `prod.vars`. Блок идёт в подоболочке `( … )`: переменные из файла уходят вместе с ней, и оболочка остаётся пригодной для `pnpm deploy:*`.
```sh
(
set -a; . ~/.config/stakeward/dev.vars; set +a
API="https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN"
curl -sS "$API/setWebhook" --data-urlencode "url=$SITE_ORIGIN/api/telegram/webhook" \
  --data-urlencode "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  --data-urlencode 'allowed_updates=["message","my_chat_member"]' -d drop_pending_updates=true
curl -sS "$API/setMyCommands" -H 'Content-Type: application/json' -d '{"commands":[
  {"command":"start","description":"Get alerts for a wallet: /start <address>"},
  {"command":"status","description":"Wallets this chat follows"},
  {"command":"stop","description":"Turn off all alerts in this chat"},
  {"command":"help","description":"How the alerts work"}]}'
curl -sS "$API/setMyDescription" --data-urlencode "description=Stakeward alerts for natively staked SOL. Send /start followed by a wallet address to get a message when one of its stake accounts changes and before a lock ends. Alerts only link to $SITE_ORIGIN. Stakeward never asks for your seed phrase."
curl -sS "$API/setMyShortDescription" --data-urlencode "short_description=Alerts for SOL stake protected by Stakeward. Site: $SITE_ORIGIN"
curl -sS "$API/getWebhookInfo"
)
```
У dev-бота оба описания начинаются с «Devnet test bot.».

Ротация токена бота — по тревоге bot-mismatch в админском чате или при подозрении на кражу (SECURITY-CHECK П17, DECISIONS D89). Для prod — prod-бот, `--env prod` в шаге 3 и адрес `https://stakeward-prod.zhibul-alexander.workers.dev/api/telegram/webhook` в шаге 4. Шаги 3 и 4 делать подряд: пока секрет вебхука в Cloudflare и в Telegram разный, бот отвечает 401 на все обновления, /start и /stop не работают.
1. BotFather → /revoke → выбрать бота → новый токен.
2. Новый секрет вебхука: `openssl rand -hex 32`. Держать на экране до шага 4, в файлы не сохранять.
3. Оба секрета в Cloudflare. Wrangler дважды спросит «Enter a secret value:», не называя секрет: первым ввести новый токен бота, вторым — новый секрет вебхука (цикл печатает имя перед каждым). В историю оболочки значения не попадут:
   ```sh
   ( set -a; . ~/.config/stakeward/secrets.env; set +a; cd apps/worker
     for name in TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET; do
       echo "$name:"
       env -i PATH="$PATH" HOME="$HOME" TERM="$TERM" CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" \
         CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" pnpm exec wrangler secret put "$name" --env dev
     done )
   ```
4. Вебхук с новым токеном и тем же секретом:
   ```sh
   ( read -rsp 'New bot token: ' TOKEN; echo; read -rsp 'New webhook secret: ' SECRET; echo
     curl -sS "https://api.telegram.org/bot$TOKEN/setWebhook" \
       --data-urlencode "url=https://stakeward-dev.zhibul-alexander.workers.dev/api/telegram/webhook" \
       --data-urlencode "secret_token=$SECRET" --data-urlencode 'allowed_updates=["message","my_chat_member"]'
     curl -sS "https://api.telegram.org/bot$TOKEN/getWebhookInfo" )
   ```
5. Проверить: `getWebhookInfo` — наш URL, нет `last_error_message`; /start в боте отвечает; в Workers Logs у следующей записи `monitor pass` поле `botCheck: "ok"`. На отсутствие тревоги bot-mismatch не полагаться: она приходит не чаще раза в час (D89), а ротацию обычно начинают как раз после неё. Если вор менял описания бота, повторить `setMyDescription` и `setMyShortDescription` из блока выше с новым токеном: `API` задать через `read -rsp`, как в шаге 4, `SITE_ORIGIN` — адрес окружения (в `dev.vars` и `prod.vars` остался отозванный токен). У dev-бота оба описания начинаются с «Devnet test bot.».
6. Если `dev.vars` или `prod.vars` ещё лежат на VPS, удалить их (SECURITY-CHECK В3): в них отозванный токен и старый секрет вебхука, а новые значения в файлы не сохраняем.
- [x] 05.10.2026: `getWebhookInfo` у обоих ботов: верный `url`, `pending_update_count: 0`, нет `last_error_message`.
- [x] 05.10.2026, dev: `/api/health` — 200, первый проход в 19:18:10 UTC.
- [x] 06.10.2026: prod (сборка 05.10) — `/api/health` 200, проход 02:48:32 UTC.
- [ ] Prod после выкатки новой сборки: `/api/health` отвечает 200 со свежим `lastMonitorRunAt` (cron может включаться до 15 минут после деплоя).

### в) Проверяю я
- [ ] Открыть `<адрес dev>/app?address=<Main key>`, нажать Get alerts in Telegram, в боте нажать Start. Ответ «Alerts are on for …». `/status` показывает кошелёк и число аккаунтов.
- [ ] Защитить devnet-аккаунт мастером шага 4 (срок 1 час).
- [ ] В кошельке снять его с делегирования (Phantom: Unstake). За 2–4 минуты приходит тревога «Stake … was deactivated …» с кнопкой Open Rescue, кнопка открывает адрес dev.
- [ ] Замок вторым ключом: на `/dev/cosign` нажать «Remove the lock with the Second key» или продлить через `solana stake-set-lockup --custodian <файл ключа K> --lockup-date <RFC3339> <STAKE> --url devnet`. Приходит тревога о замке (LOCKUP_CHANGED).
- [ ] `/stop`: следующее изменение приходит без сообщения.
- [ ] По желанию: заблокировать бота, разблокировать, `/status` показывает, что привязок нет.

### г) CPU (решение Free или Paid)
Решение 05.10.2026: пока Free, подтверждено 06.10.2026. Первый проход dev (0 строк, холодный изолят) занял 9 мс CPU из 10.
- [ ] Через сутки в Cloudflare: Workers & Pages → stakeward-dev → Observability → Logs. Отфильтровать вызовы cron (scheduled), посмотреть CPU time (поле `$workers.cpuTimeMs`, если имя другое — колонка CPU time). Прислать в чат:
  - максимум за 24 часа;
  - есть ли исходы Exceeded CPU;
  - приходили ли тревоги «the previous pass did not finish».
- [ ] Запасной путь — GraphQL Analytics, набор `workersInvocationsScheduled`, поле `cpuTimeUs`.
- [ ] После выкатки новой сборки в dev — замерить снова: с 06.10.2026 каждый проход ещё спрашивает у Telegram вебхук (`getWebhookInfo`), а суточная часть читает до 250 строк напоминаний (DECISIONS D88, D89). Заодно: в админском чате нет тревог bot-mismatch; в Workers Logs у запросов `/api/stake-accounts` и `/api/accounts` нет `?withdrawer=` и `?wallet=` (D95).

## Шаг 8. Карточка восстановления (команды CLI)

- [ ] Пополнить спонсора devnet `D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL` ещё на 1,13 SOL (или на 0,13 SOL для прогона с `--skip-delegated`). Вернётся всё, кроме комиссий (около 0,0004 SOL).
- [ ] Поставить Solana CLI 4.3.0: `sh -c "$(curl -sSfL https://release.anza.xyz/v4.3.0/install)"` (или попросить меня: я запускаю его из своей среды).
- [ ] `pnpm recovery-cli --url devnet --dry-run` печатает план и сумму, ничего не отправляя. Затем `pnpm recovery-cli --url devnet`: все проверки зелёные, раздел devnet в `docs/recovery-cli.md` заполнен ссылками на эксплорер.
- [ ] Прочитать раздел README «Recover without Stakeward» глазами человека, у которого украли ключ.

## Шаг 6. Вывод, продление, снятие замка

- [ ] Вывод из защищённого неделегированного аккаунта: `/withdraw/<аккаунт>`, подписывают Main key и Second key. Аккаунт исчезает, SOL приходят на основной ключ.
- [ ] Продление другого аккаунта одним вторым кошельком: в браузере на компьютере и во встроенном браузере кошелька на телефоне. В эксплорере новая дата и комиссия списана со второго ключа.
- [ ] Опустошить второй кошелёк и продлить снова: экран говорит, что платит основной ключ, Main key подписывает первым, и предупреждает «If your main key may be stolen, send SOL to the second key instead.»
- [ ] Опустошить и основной кошелёк: страница просит пополнить Second key, а не Main key.
- [ ] С `/withdraw` пройти «Remove the lock first»: галочка, подписывает Second key, затем вывод одним Main key. Перед снятием видно предупреждение, что это открывает окно для вора.
- [ ] Снять делегированный аккаунт с делегирования и сравнить отсчёт с концом эпохи в эксплорере.

## Шаг 7. Спасение, nonce, подпись по ссылке

- [ ] Спасение двух защищённых аккаунтов на новый кошелёк тремя кошельками в одном браузере: `/rescue?address=<Main key>`. На новом кошельке около 0,01 SOL. Если New wallet — ещё один аккаунт того же Phantom, на шагах New wallet, Keys и Move видно предупреждение, что ключи в одном кошельке, и совет подписывать, только если у нового кошелька своя seed-фраза. На Ledger (если есть) поле «New authority» равно новому кошельку. В эксплорере у обоих аккаунтов оба ключа — новый кошелёк, дата замка та же. Затем делегировать снова и закрыть link-signing account.
- [ ] По желанию «вор сменил staker»: если Main key — файл ключа, `solana stake-authorize-checked <аккаунт> --new-stake-authority <другой ключ> --stake-authority <main.json> --url devnet`. На `/app?address=<Main key>` у аккаунта «Another key can stop or move this stake. If you did not set this up, your main key may be stolen.» и Open Rescue; спасение того же аккаунта проходит.
- [ ] Вывод по ссылке: Main key подписывает на компьютере, QR-код сканирует телефон, ссылка открывается во встроенном браузере кошелька второго ключа, галочка, подпись. Компьютер сам показывает «Done».
- [ ] Отменить ссылку и открыть её снова: «already used or cancelled».
- [ ] Защита по ссылке с вставленным адресом второго ключа. Подсказка под полем: «Paste only the address of a wallet you or a person you trust created…».
- [ ] Строки матрицы кошельков: меняет ли Phantom (Solflare, Backpack) байты, которые уже подписал другой кошелёк; предупреждения на nonce-транзакциях; что показывает Ledger.

## Шаг 8. Тексты

Читать на https://stakeward-dev.zhibul-alexander.workers.dev, на 1280 и на 360 (DevTools → Toggle device toolbar → 360), сверху вниз. Состояния без кошельков — в `docs/screens/*.png` и на `/dev/ui`. Правки писать в чат: экран, текст сейчас, как должно быть; я вношу их одним коммитом и переснимаю экраны.

Правила:
- Один главный шаг: на экране одна залитая кнопка.
- Риск до действия, простыми словами и с датой.
- Перед подписью: было → станет, кто подписывает, сколько стоит, чего транзакция не может, «Stakeward never asks for your seed phrase».
- Роли только Main key, Second key, New wallet; слов custodian, withdrawer, staker нет нигде, кроме FAQ и карточки восстановления.
- Статус виден словом, цветом и значком; каждое ожидание объяснено и имеет выход; ошибка говорит, что делать, исходный текст под Details.
- На 360 всё читается без горизонтальной прокрутки. Нет «2FA» и обещаний сверх проверенного.

Экраны:
- [ ] Шапка и подвал: Source code, What Stakeward cannot do, Stats, No warranty.
- [ ] `/`: заголовок, схема в три шага, What Stakeward cannot do, таблица кошельков, FAQ целиком (открыть каждый вопрос), особенно «What will my Ledger show?», «My main key was stolen», «What do custodian, withdrawer and staker mean?».
- [ ] `/app` без адреса; загрузка, ошибка (DevTools → Network → Offline), пусто.
- [ ] `/app?address=<Main key>`: статусы, красный баннер, «You are the second key for», Last checked, Get alerts in Telegram, Rescue, Recovery card.
- [ ] `/protect` шаги 1–5, `/withdraw/<аккаунт>`, `/extend/<аккаунт>`, `/rescue?address=<Main key>`, `/cosign` (битая ссылка и живая).
- [ ] `/recovery/<аккаунт>`: экран и печать (Ctrl+P → предпросмотр). Особенно: предупреждение «Check the second key first» вверху, время «00:00 UTC», шаги «Your main key is stolen», «If a command fails», «What no one can undo».
- [ ] `/stats` и `/no-such-page`.
- [ ] Telegram в dev-боте: /start, /status, /stop, тревога каждого типа, напоминания.
- [ ] Факты в вопросе FAQ «Has staked SOL really been stolen like this?» верны, называть компании можно.
- [ ] FAQ «How can I check my lock without Stakeward?»: открыть защищённый devnet-аккаунт на explorer.solana.com (сеть Devnet) и сверить надписи из ответа: баннер «Account is locked! Lockup expires on …», Lockup Authority Address (второй ключ), Withdraw Authority Address (основной ключ). Надписи взяты из исходников эксплорера, на живой странице не сверены (SECURITY-CHECK П26).

## Выкатка новой сборки

Деплой и удалённые миграции — только по слову владельца (DECISIONS «Развёртывание»), команды из корня репозитория, в оболочке без подключённого файла секретов. Обёртка откажет на грязном дереве, на HEAD не с origin и, для prod, без зелёного check на HEAD (D96).

### а) Dev

- [ ] `pnpm deploy:dev`. Обёртка дописывает раздел в `docs/deploys.md`: закоммитить и запушить.
- [ ] Миграция 0004 после деплоя кода (D90): применить командой из DECISIONS D96 (подоболочка, только два ключа Cloudflare); `migrations apply` сам покажет 0004 среди неприменённых и спросит подтверждение. Без ключей в окружении wrangler на VPS не работает (OAuth-входа там нет), поэтому и отдельный список — в такой же подоболочке, с `pnpm exec wrangler d1 migrations list DB --remote --env dev` в `apps/worker`.
- [ ] `pnpm verify-deploy --env dev --commit <sha>` — PASS.
- [ ] `curl -sI https://stakeward-dev.zhibul-alexander.workers.dev/app` — есть `cross-origin-opener-policy: same-origin`; `/api/health` — 200 через 2–4 минуты.

### б) Prod

Prod работает на https://stakeward-prod.zhibul-alexander.workers.dev, но там сборка от 05.10 (до шагов 4–8). Выкатывать — после того, как пройдены шаги 4–8 в dev.

- [ ] Решение владельца: выкатить текущую `build/product` в prod. Перед этим догнать main до `build/product` (В7).
- [ ] Зелёный check на HEAD в GitHub Actions. Можно сначала `pnpm deploy:prod --prod-confirm --dry-run`.
- [ ] `pnpm deploy:prod --prod-confirm`; закоммитить и запушить `docs/deploys.md`. Я могу сделать это сам по вашему слову.
- [ ] Миграция 0004 на prod той же командой с `db:migrate:prod`.
- [ ] `pnpm verify-deploy --env prod --commit <sha>` — PASS.
- [ ] `curl -s https://stakeward-prod.zhibul-alexander.workers.dev/api/health` — 200 через 2–15 минут; все маршруты открываются; в подвале нет пометки Devnet; на `/app` есть COOP.
- [ ] Старый preview-адрес `https://037f86ff-stakeward-prod.zhibul-alexander.workers.dev/` больше не открывается (SECURITY-CHECK В5).
- [ ] Форма проверки домена в Phantom для адреса prod, если предупреждение о новом домене держится (ссылка в «Шаг 3 д»).

## Перед подачей: за владельцем

Пункты В1–В9 из docs/SECURITY-CHECK.md, «За владельцем».

- [x] 06.10.2026, В1: решение — пока Workers Free.
- [ ] В1. CPU проходов после деплоя (Шаг 5 г): если подходит к 10 мс, вернуться к Workers Paid; настоящая тревога и LOCKUP_CHANGED в dev (Шаг 5 в).
- [ ] В2. Домен: купить или оставить workers.dev; вписать адрес в README и описания ботов; форма Phantom; на своём домене — Always Use HTTPS и выключить Network Error Logging. Решить, называть ли адрес prod до шага 9 (П24).
- [ ] В3. 2FA на Cloudflare, GitHub и аккаунте Telegram, который владеет ботами. Токен Cloudflare с минимальными правами и сроком жизни, отзывать после деплоя. В `~/.config/stakeward/secrets.env` оставить только `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`, удалить `dev.vars` и `prod.vars`. Защита ветки main и запрет force-push.
- [ ] В4. Dependabot alerts в настройках GitHub.
- [ ] В5. Preview-адреса prod: выключить Preview URLs в настройках воркера stakeward-prod в панели Cloudflare или дождаться деплоя prod с `preview_urls: false`; проверить, что старый адрес не открывается.
- [ ] В6. BotFather `/setjoingroups` → Disable у обоих ботов.
- [x] 06.10.2026, В7: main перемотан до `build/product` (ссылки сайта на README и docs/gate.md и суточный аудит CI идут по main). Перед деплоем prod догонять снова.
- [ ] В8. Второй ключ Helius (или платный план) только для монитора.
- [ ] В9. Решение: разрешить ли спасение пачкой по блокхэшу, когда все три ключа в одном браузере (сейчас всегда nonce, по аккаунту за раз).
