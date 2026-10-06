# Проверка безопасности

Проход по CLAUDE.md §11 от 06.10.2026: каждая угроза и каждое обязательное правило со статусом и доказательством. Первый проход шёл по ветке `build/web` на коммите bcc1170 (равна `build/product`). Источники: чтение кода и тестов, прогоны тестов, curl по dev и prod, чтение настроек Cloudflare и ботов Telegram через API (без изменений), чтение программы Lighthouse в mainnet. Спорные пробелы проверял отдельный агент, который пытался их опровергнуть. Prod не трогали.

Обновлено 06.10.2026 (около 06:00 UTC) на `build/product` a5f563c: три слияния (ca3d145 сайт, de30b98 воркер, a5f563c эксплуатация) закрывали открытые пробелы. Каждый пробел заново сверен с кодом и тестами, а не с сообщениями коммитов; найдены ещё два пробела (П27, П28), они исправлены коммитами d0c5e7d и 6ec7779. Номера строк в разделах «Угрозы» и «Обязательные правила» местами остались от bcc1170; в «Исправлено» и «Открытые пробелы» — на a5f563c.

Статусы:
- **выполнено** — правило работает, доказательство приведено;
- **пробел исправлен** — пробел найден и исправлен 06.10.2026 с тестом, который до исправления падал (у П7 — новый тест поведения программы в сети, код не менялся; у П20 и П21 — настройки pnpm и CI без отдельного теста);
- **частично** — сделана часть, остаток в таблице «Открытые пробелы»;
- **открыт** — пробел найден, не исправлен; в таблице «Открытые пробелы» сказано, почему он остаётся и что сделать;
- **за владельцем** — сделать может только владелец (аккаунты, деньги, решения по модели безопасности по §15).

Где что развёрнуто: dev — сборка 8beb55d от 06.10.2026 03:29 UTC (там П1–П3 и обёртка деплоя). Исправления сайта и воркера из ca3d145 и de30b98 есть только в `build/product`; dev ждёт деплоя вместе с миграцией 0004, prod — на сборке 05.10.

## Итог

- Обязательные правила §11 выполнены, кроме одного: README не называет домен prod (D84, решение владельца, О7). Механизм замка держит в сети на трёх кластерах всё, что обещает продукт: вор с одним основным ключом не выводит SOL, не меняет право вывода и не трогает замок.
- Из 26 пробелов первого прохода 19 исправлены: П1–П3 сразу (100ec6f), П5–П8, П10–П16, П20, П21, П23, П25 и П26 тремя слияниями. Пять закрыты частично: П4, П9, П17, П18, П19. Открыты два: П22 (средний, общий ключ Helius у прокси и монитора) и П24 (домен, решение владельца).
- При сверке найдены и исправлены ещё два: П27 — `pnpm test` в CI падал на гонке блокхэша в тестовой обвязке LiteSVM, из-за этого `check` был красным на a5f563c; П28 — обёртка отказала бы в деплое prod с HEAD ветки main после суточного аудита по расписанию.
- По-моему, до первых пользователей на mainnet нужно: выкатить `build/product` в dev и prod вместе с миграцией 0004, закрыть П22 (В8) и сделать В1–В3, В5, В6. Остальное можно после.

## Угрозы

### У1. Кража основного ключа — выполнено; П6 и П16 исправлены, П4 частично

- Замок в сети: docs/gate.md, проверки 3 (Withdraw одним A → LockupInForce), 4 (AuthorizeChecked(Withdrawer → X) с A и X → CustodianMissing), 5 (SetLockup от A при действующем замке → MissingRequiredSignature), 8b (Split копирует замок, Withdraw из S2 → LockupInForce), 14a. LiteSVM 24 из 24, devnet 21 из 21, mainnet 8 из 8. `scripts/gate/gate.test.ts` гоняет план в CI. Правило замка — core `lockup.ts` `isLockupInForce`.
- Спасение F4: `packages/core/src/builders.ts:117-122` собирает спасение только с плательщиком D и nonce у D; инспектор проверяет это контрольной пересборкой. Мастер: `apps/web/src/pages/rescue/wizard.ts` `newWalletProblems` (D не основной ключ, не второй ключ, не стейк-аккаунт, не нулевой), галочка новой seed-фразы, проверка баланса D. Тесты `apps/web/test/rescue.test.tsx`: вор сменил staker и снял с делегирования (`core/test/thief.ts`), второй ключ по ссылке, Split во время прогона находится через «Look again». gate 11a–c, 12b.
- Тревоги DEACTIVATED, STAKER_CHANGED, DELEGATION_CHANGED ведут на «Open Rescue» (core `diff.ts:291-314`, D73). Предупреждение «do not withdraw to it, use Rescue» стоит на /withdraw до подписи (`WithdrawPage.tsx:138`).
- Чего замок не даёт: вор может дробить, снимать с делегирования и менять staker. Отсюда П4 и П6. Теперь /app на строке под замком владельца с чужим staker пишет, что основной ключ может быть украден, и даёт Open Rescue (П6); лендинг и FAQ говорят про дробление и предел 10 аккаунтов за спасение (П4).

### У2. Фишинговая транзакция со скрытым Authorize — выполнено; П7 исправлен

- В сети: gate 4 (CustodianMissing) на LiteSVM, devnet и mainnet. Непроверяемый Authorize(Withdrawer), вектор SwissBorg, на LiteSVM с программой mainnet: CustodianMissing от одного основного ключа и LockupInForce с чужим ключом в слоте хранителя, в обеих раскладках аккаунтов (П7, `packages/core/test/errors.svm.test.ts`).
- Stakeward такую транзакцию не соберёт и не пропустит. Инспектор принимает AuthorizeChecked только парой спасения; одиночный AuthorizeChecked и непроверяемый Authorize → `unknown-instruction` (`packages/core/src/inspect.test.ts:535`). Прокси: `apps/worker/test/rpc.test.ts:197-299` (перевод System → -32602, неподписанная или подписанная одним A → -32003). Живая проба 06.10.2026 на dev и prod: TransferSol, SetLockupChecked с дописанным переводом, Authorize(Withdrawer), Split и мусор отклонены инспектором.
- Хвост Lighthouse: программа `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` в mainnet неизменяемая — programdata `CJ5WEjifs4d77pEA9DpewppByFjHcAkNv3YYSuSoDk7c`, authority null (слоты 453762273 и 453762471). Вопрос D24 «кто может обновлять Lighthouse» закрыт. `checkSigningStep` пускает хвост только на неподписанную транзакцию и без новых подписантов и записываемых аккаунтов (`verify.ts:109-125`).

### У3. Кража второго ключа — выполнено; П8 исправлен, П9 частично

- Вывод и спасение без основного ключа не собираются: в `builders.ts` withdraw и rescue подписывает mainKey. Второй ключ никогда не владеет nonce (D67). Если у второго ключа нет SOL, F5 переводит оплату на основной ключ, только если тому самому хватает, и предупреждает «If your main key may be stolen, send SOL to the second key instead» (П16).
- Ограничение названо прямо: RiskNote `second-key-can-freeze` на `SecondKeyStep.tsx:82` и `CosignSigning.tsx:178`, `landing.cannotDo.items.freeze`, `recovery.cases.stolenSecond`, FAQ second-stolen.
- Тревога «your second key may be stolen» при смене хранителя: `diff.ts:343-346`, `diff.test.ts:269, 387`.
- На LiteSVM: второй ключ один не выводит и не меняет основной ключ; после того как он передал замок X, вывод основным и старым вторым ключом падает (П9). Совет «use your second key only to co-sign Stakeward transactions» на шаге второго ключа и в FAQ (П8).

### У4. Оба ключа из одной seed-фразы — выполнено; П5 исправлен

- core `validateSecondKey` (`lockup.test.ts:113-122`): второй ключ не равен основному, staker, стейк-аккаунту и нулевому ключу.
- Мастер не идёт дальше без галочки «My second key comes from a different seed phrase» (`protect.test.tsx:599-656`). Слот второго ключа не принимает основной (D35). У нового кошелька при спасении своя галочка (`rescue.newWallet.seedCheck`). Два ключа в одном кошельковом приложении — предупреждение на /protect и /rescue (П5, D94).
- Тексты: `protect.second.seedHint`, FAQ different-seed и good-second-key, `landing.cannotDo.items.sameSeed`, `recovery.limits.sameSeed`.

### У5. Забытое продление — П1, П10, П11 исправлены; за владельцем В1

- Напоминания за 30, 14, 7, 3 и 1 день (core `REMINDER_DAYS`, `reminderDue`, ссылка на /extend/:account), EXPIRED один раз (`events.test.ts:189`), Expiring меньше 30 дней (`status.test.ts:62-63`), красный баннер F6 (`app-page.test.tsx`, `app/view.test.ts`, `app-f6-memory.review.test.tsx`), дата до подписи (PeriodStep «Locked until {date}», RiskNote lose-second-key).
- П1: суточная выборка напоминаний брала первые 1000 строк, и чужие дешёвые замки вытесняли из неё всех остальных. Исправлено.
- Доставку настоящей тревоги в Telegram владелец ещё не проверил (TESTPLAN «Шаг 5», пункт в).

### У6. Взломанный сайт или сервер Stakeward — П2, П12, П13, П26 исправлены; П18, П19 частично; открыт П22

- Лежащий сервер: пропадают сайт и тревоги, SOL нет — замок живёт в стейк-программе, команды CLI с карточки работают без Stakeward (docs/recovery-cli.md, 26 из 26 на тест-валидаторе).
- Взломанный API или Helius при целой статике деньги не перенаправит. Байты собирает браузер, сводку панель строит из них (`apps/web/src/signing/session.ts:627` `checkSigningStep`, `:648` и `:906` `inspectTransaction`, `:670` `verifyAllSignatures`). Второй ключ и D берутся только из подключённых кошельков или введённого адреса, получатель вывода — всегда основной ключ (D64). Ложные ответы RPC ломают транзакцию, но не меняют адреса. Часы кластера сверяются с часами устройства (П12), прокси пропускает вывод только на основной ключ (П13), FAQ объясняет, как проверить замок по эксплореру без Stakeward (П26).
- Взломанный деплой (аккаунт Cloudflare, токен деплоя, VPS) — это взломанный сайт: подменённый код может попросить вредную подпись, и инспектор в нём тоже подменён. Кодом это не закрывается. Защита — то, что показывает кошелёк или Ledger (New authority, To), открытый код и тексты: лендинг `landing.security.items.site`, README «If Stakeward were hacked». Prod теперь выкатывается только через обёртку (у dev остался аварийный `deploy:dev:raw` без проверок), которая собирает без секретов и пишет хеши файлов, а `pnpm verify-deploy` сверяет живой сайт с коммитом (П18, П19, D96).
- П2: лендинг обещал «If it is hacked or down, you lose alerts, not SOL». Это верно только для «down». Исправлено.

### У7. Украденный токен Telegram-бота — выполнено; П17 частично; за владельцем В2, В3, В6

- Токен только в секретах воркера и в URL запроса к Telegram, в лог не пишется (`apps/worker/src/telegram/api.ts`).
- Кнопка тревоги ведёт только на `SITE_ORIGIN`: `siteUrl` отклоняет путь без `/`, `//` и чужой origin (`api.ts:63-67`, `test/telegram/api.test.ts:58-68`); `SITE_ORIGIN` принимается только точным https-origin (`monitor/config.ts`). Сообщения без `parse_mode`, превью ссылок выключено, кнопок с callback нет.
- Вебхук: секрет сравнивается в постоянное время до чтения тела и D1 (`webhook.ts`, `webhook.test.ts:137`). 06.10.2026 на dev и prod чужой секрет получает 401; `getWebhookInfo` обоих ботов — верный url, очередь пуста.
- Chat id хранятся только в D1, через Bot API их не узнать. С токеном вор может перенаправить вебхук на себя; теперь каждый проход монитора (раз в 2 минуты) сверяет вебхук, и чужой URL или свежий 401 дают тревогу bot-mismatch админу (П17, D89).

### У8. Фишинговая ссылка /cosign держателю второго ключа — выполнено

- Фрагмент `#tx=` не уходит на сервер, плюс `Referrer-Policy: no-referrer`.
- До чтения сети `readLink` (`pages/cosign/read.ts:27-34`) прогоняет инспектор и core `cosignLinkProblem`: только protect, withdraw и rescue; только на nonce плательщика; плательщик ожидаемый и уже подписал проверенной подписью; withdraw только на основной ключ.
- По сети (`pages/cosign/plan.ts`): done, not-found, link-used, stale (withdrawer не основной ключ), already-locked (protect поверх действующего замка, иначе вор с A мог бы через ссылку поставить раннюю дату).
- Withdraw и rescue: красное предупреждение с полным адресом получателя или D, текст «A thief who has the main key would send you exactly this request», обязательная галочка. Тесты `apps/web/test/cosign.test.tsx:136-260`, `rescue.test.tsx:376-389`, e2e `smoke.spec.ts:183` (`/cosign#tx=@@`).
- Остаётся социальная инженерия: вор с A присылает настоящую ссылку на вывод на A или на спасение на своего D. Формально она верна; держится на тексте и галочке, сильнее продуктом не сделать.

### У9. Поддельный сайт ставит хранителем вора — П3 и П14 исправлены; за владельцем В2

- Настоящий /app показывает хранителя, которого нет среди известных вторых ключей, как «Locked by another key» (core `status.ts:82`, D35). Известные ключи лежат в localStorage настоящего origin, чужой сайт туда не пишет. Тесты `apps/web/src/pages/app/view.review.test.ts:8-40`, `apps/web/test/app-ux.review.test.tsx:150-162`. FAQ fake-site: закладка, поле New authority на Ledger, «Locked by another key».
- П3: фишинговая страница, открывшая Stakeward через `window.open`, могла позже подменить эту вкладку на копию. Проверено Playwright на dev до исправления: вкладка ушла на чужой адрес. Исправлено.
- Независимой опоры «вот настоящий домен» пока нет: README не называет prod, домен временный (В2, П24).

### У10. Подмена зависимости в npm — выполнено; П20 и П21 исправлены, П19 частично

- Точные версии во всех package.json, `workspace:*` для своих пакетов, `savePrefix: ''`. В pnpm-lock.yaml нет git, tarball и чужих registry, 567 записей integrity. Install-скрипты разрешены только esbuild и workerd (`allowBuilds`).
- CI (`.github/workflows/ci.yml`): `pnpm install --frozen-lockfile`, `pnpm audit`, действия закреплены по SHA, `persist-credentials: false`, `permissions: contents: read`.
- `pnpm audit` 06.10.2026: «No known vulnerabilities found».
- Строгий `minimumReleaseAge: 1440` и `trustPolicy: no-downgrade` (П20, D97); суточный аудит по расписанию (П21).
- Бандл сайта ограничен CSP `connect-src 'self'`: подменённая зависимость в бандле может слать транзакции только через /api/rpc, а там инспектор (П13 — что ещё можно ужесточить).

## Обязательные правила

### О1. Экран подписи показывает сводку инспектора по тем самым байтам; подписанная транзакция проверяется по §6 — выполнено; П15 исправлен

- Свои сборки: `session.ts:380-383` собирает байты, `inspectOwn` (`:919-929`) требует, чтобы инспектор прочитал из них то же действие и того же плательщика. Байты /cosign идут через `readLink` и `inspectBytes` (`session.ts:905-916`). После каждого кошелька байты читаются заново и сводка на экране заменяется (`:646-665`, там же с П15 проверка, что кошелёк подписал). `SigningPanel.tsx` рисует только `state.round.txs[].summary`.
- Все пути подписи используют `PageSigningPanel` поверх `createPageSession`: protect, withdraw и deactivate, extend и unlock, rescue, delegate, создание и закрытие nonce (с отменой ссылки), /cosign. Единственный вызов `wallet.signTransactions` в продукте — `session.ts:589`.
- §6: `checkSigningStep` после каждой подписи по всем транзакциям этапа, первое расхождение останавливает этап (`session.ts:626-640`); `verifyAllSignatures` перед каждой отправкой (`:669-673`); в режиме ссылки `cosignLinkProblem` до показа ссылки. В `sending` ведёт только событие `signed` после этих проверок (`machine.ts:339`). Буферы копируются в обе стороны (`ports/wallet-standard.ts:142, 159`). Прокси повторяет проверку (`apps/worker/src/rpc.ts:119-142`).
- Прогон 06.10.2026 (аудит): `apps/web` `vitest run test/signing-session.svm.test.ts test/cosign.test.tsx test/rescue.test.tsx test/link.test.tsx test/signing-link.svm.test.ts` — 5 файлов, 81 из 81.

### О2. При спасении новый владелец — подключённый D, адрес целиком, D подписывает — выполнено

- D берётся только из слота New wallet, когда подключённый кошелёк отдаёт этот аккаунт (`RescueWizard.tsx:99`, `ports/slots.ts:87`), и фиксируется в прогоне (`:259`).
- Адрес целиком: `MoveStep.tsx:43-44` до подписи, сводка «Controlled by: Main key -> New wallet» и список подписантов (`transaction-summary.tsx:179-205, 359-365`).
- Инспектор принимает только пару AuthorizeChecked, где новый владелец обязан подписать (`inspect.ts:468`, `rescueAction` `:799`). D всегда подписывает на этом устройстве: `checkLinkPlan` отклоняет план, где D — удалённый подписант (`session.ts:896-902`). /cosign для спасения показывает D целиком с обязательной галочкой.

### О3. Скомпрометированный ключ не платит комиссию и не владеет nonce — выполнено; П16 исправлен

- Спасение: сборщик отказывает, если плательщик или владелец nonce не D (`builders.ts:117-121`); инспектор пересобирает каждое сообщение этим сборщиком, поэтому прокси и /cosign отклоняют другого плательщика. `expectedFeePayer` для спасения — D (`actions.ts:145-162`). Делегирование после спасения, создание и закрытие nonce платит D.
- Захват выведенного адреса nonce (его может заранее пополнить кто угодно) даёт отказ `unusable`, экран просит подключить другой новый кошелёк (`nonce.blockedRescue`).
- П16 исправлен: F5 больше не просит пополнить основной ключ, который может быть украден.

### О4. Заголовки на всех ответах, без сторонних скриптов, шрифтов и аналитики — П3 исправлен; за владельцем В2, В5

- Статика: `apps/web/public/_headers`. curl 06.10.2026 по dev и prod (`/`, все маршруты §9, 404, SPA-фолбэк, редирект `/index.html`, каждый файл `/assets`): ровно CSP из §11 (`default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`. В index.html нет inline-скриптов и стилей.
- /api: `apps/worker/src/security-headers.ts` для каждого маршрута, включая ошибки (404, 413, 415, 401, 302); те же пять значений, включая COOP (D86), плюс X-Frame-Options DENY. `apps/worker/test/security-headers.test.ts` и `e2e/smoke.spec.ts:241-243` держат их одинаковыми.
- `style-src-attr` не понадобился: Radix-примитивы со `<style>` не используются (D3, D29).
- Сторонних скриптов, шрифтов и аналитики в mainnet-бандле нет: внешние URL — только эксплорер, GitHub, docs.anza.xyz и release.anza.xyz (текст команды на карточке), служебные ссылки React и Tailwind. Шрифты — 11 своих woff2. Сеть — только `/api/*`.
- П3: COOP `same-origin` добавлен на страницы. В §11 его нет; добавлен сверх списка против подмены вкладки (D86). На dev с 06.10.2026 03:29 UTC: `pnpm verify-deploy --env dev` нашёл пять заголовков `_headers` на 26 ответах. На prod — после деплоя.
- HTTP без редиректа: `http://…workers.dev/app` отдаёт 200. Сейчас не важно (вся зона .dev в HSTS preload), станет важно на своём домене (В2).
- Cloudflare добавляет ко всем ответам `report-to`/`nel` на a.nel.cloudflare.com: при сетевых сбоях браузер шлёт туда URL страницы с query (`/app?address=…`, без `#tx`). На workers.dev не отключить; на своём домене — настройка зоны (В2).

### О5. Нет dangerouslySetInnerHTML; всё из сети и ссылки выводится текстом — выполнено

- grep по `apps/web/src`, `apps/worker/src`, `packages/core/src` на dangerouslySetInnerHTML, innerHTML, outerHTML, insertAdjacentHTML, document.write, new Function, eval(, srcdoc, createContextualFragment, DOMParser — пусто. ESLint запрещает проп (`eslint.config.js:40-44`).
- `t()` — замена строк, вывод JSX-текстом; рендереров markdown и HTML среди зависимостей нет. Динамические href — проверенные адреса или константы, `explorerUrl` кодирует значение. CSP без `unsafe-inline` блокирует `javascript:`. Фрагмент /cosign разбирается строго (`link.ts` `decodeBase64Url`: каноничность, не больше 1232 байт).

### О6. Зависимости: точные версии, frozen lockfile, pnpm audit в CI, обновление — отдельный коммит — выполнено; П20 и П21 исправлены

- См. У10. Обновлений версий пока не было: lockfile менялся в 6 коммитах, каждый добавлял новые зависимости со строкой в DECISIONS «Зависимости», ни одна существующая версия не поднималась.

### О7. В тревогах ссылки только на домен Stakeward; домен в README и в описании бота — ссылки выполнено; домен за владельцем (В2); открыт П24

- Ссылки: см. У7. Доставка 06.10.2026: `/api/telegram/link` отвечает 302 на своего бота (`stakeward_dev_bot`, `stakeward_bot`); `evil`, CRLF, обход пути и нулевой адрес — 400.
- Описания ботов называют свои адреса (dev — `https://stakeward-dev.zhibul-alexander.workers.dev`, prod — `https://stakeward-prod.zhibul-alexander.workers.dev`) и «never asks for your seed phrase». README называет только dev (README.md:7, :441): адрес prod не публикуется до шага 9 (D84).

### О8. В сборке сайта нет секретов; ключ Helius и токен бота в секретах воркера — выполнено; П23 исправлен, П19 частично

- Поиск по шаблонам (api-key, helius, токен бота `\d{8,10}:[A-Za-z0-9_-]{35}`, RPC_URL, TELEGRAM_*, ADMIN_CHAT_ID, BEGIN PRIVATE) в свежей mainnet-сборке и в живых бандлах dev и prod — только ложные срабатывания.
- Точные значения CLOUDFLARE_API_TOKEN, HELIUS_API_KEY, токенов ботов, ADMIN_CHAT_ID и секретов вебхуков (сравнение без вывода) не найдены ни в сборках, ни в исходниках, ни в docs; `git grep -F` по всем 98 коммитам — 0. В Cloudflare RPC_URL, TELEGRAM_* и ADMIN_CHAT_ID лежат как `secret_text`.
- Код не пишет в лог URL с ключом или токеном. Трассировки выключены явно, query-строки входящих запросов в логах маскируются (П23, D95).

### О9. Нет полей и путей кода для seed-фраз и приватных ключей вне scripts/ и тестов; тестового кошелька нет в prod — выполнено

- grep без учёта регистра по отслеживаемым файлам вне scripts/ и тестов на mnemonic, secret_key, private_key, keypair, fromSecretKey, createKeyPairFromBytes, createKeyPairSignerFromBytes, generateKeyPair, importKey, pkcs8, bip39, derivePath: только тексты «never asks for your seed phrase», комментарии и сгенерированные типы воркера.
- Поля ввода: `signing/AddressField.tsx` и `pages/app/AddressForm.tsx` (публичный адрес, только если проходит `isAddress`), демо на /dev/ui, поле ссылки только для чтения. localStorage хранит только адреса. `.gitignore` закрывает `.env*`, `.dev.vars*`, `.keys/`.
- `apps/web` `vitest run test/build-output.test.ts test/test-code-guard.test.ts` — 12 из 12 (06.10.2026, аудит). Guard собирает mainnet и ищет метки двойников, litesvm, generateKey, pkcs8, `solana:signMessage`, `solana:signIn`, у каждого двойника положительный контроль. Живые бандлы dev и prod этих меток не содержат. `importKey` в бандле — только импорт публичного Ed25519 для проверки подписи.

### О10. Репозиторий открыт (MIT), «No warranty» в подвале и README — выполнено; В7 сделан

- `SiteFooter.tsx` на каждом маршруте: «No warranty. MIT license.», строка есть в живых бандлах dev и prod. README.md:461-465, LICENSE (MIT), `license: MIT` во всех package.json. github.com/Zhibul-Alexander/stakeward отвечает 200.
- Ссылки сайта ведут на ветку main (`config.ts:23-29`): `#recover-without-stakeward`, `blob/main/docs/gate.md`. С 06.10.2026 main догнан до `build/product` (В7), ссылки ведут на актуальные README и docs/gate.md.


## Исправлено 06.10.2026

П1–П3 исправлены первым проходом (коммит 100ec6f) и с 06.10.2026 03:29 UTC работают на dev (сборка 8beb55d). Остальные — тремя слияниями в `build/product` (ca3d145, de30b98, a5f563c), они ещё не развёрнуты. П27 и П28 исправлены коммитами d0c5e7d и 6ec7779. У каждого пробела — что было, что стало и какой тест его держит.

### П1. Суточная выборка напоминаний вытеснялась чужими замками (средний)

- Было: `DAILY_REMINDER_ROWS` брал `ORDER BY lock_until LIMIT 1000` без фильтра по `last_reminder_days` и без курсора; суточный этап закрывался после одной выборки. `/api/watch` не ограничивает число строк (D49). Атака: 1000 стейк-аккаунтов со своим хранителем и концом замка чуть раньше нужного (залог около 1,7–2,3 SOL, возвратный), 50 запросов `/api/watch` — и ни один пользователь с более поздним концом не получает напоминаний. Воспроизведено точным SQL на node:sqlite с миграциями репозитория: «rows 1000, victim included false».
- Стало: выборка берёт только строки, где напоминание положено (`CASE` повторяет core `reminderDue`), листается по `stake_account` после курсора `meta.daily_sweep`, страница `reminderPageRows` (free 250, paid 1000). `daily_day` пишется только после неполной страницы; незакрытый этап продолжается в любой час (D88). После 8f0cead и 3b7bd59 это держится: из суточного этапа ушла только выборка пар, `COST.daily` — 4.
- Тесты: `apps/worker/test/monitor/reminders.test.ts` (1000 замков с отправленным напоминанием плюс жертва — до исправления `reminders: 0`; 1001 напоминание к одному утру; проход, упавший после полной страницы; этап через полночь), `store.test.ts` (курсор и совпадение SQL с `reminderDue` на 108 сочетаниях у границ порогов), `marker.test.ts`.
- Не замерено: CPU страницы из 250 строк на Cloudflare (В1).

### П2. «If it is hacked or down, you lose alerts, not SOL» (средний по аудиту, низкий по проверке)

- Сайт и API отдаёт один Worker, поэтому взломанный деплой — это взломанный сайт (У6). Фраза была верна только для «down».
- Стало: `landing.security.items.server` — «If it is down, you lose alerts, not SOL. The same server delivers this website, so a hacked server means a hacked website…». README (d5951eb) и docs/SUBMISSION.md (dd9cd96) говорят так же. Расхождение с CLAUDE.md §2.6 записано в D87.
- Тест: `apps/web/test/landing.test.tsx` («promises "alerts, not SOL" only for a server that is down…»).

### П3. Нет Cross-Origin-Opener-Policy на страницах (низкий)

- Было: COOP стоял только на /api (умолчание Hono, D10). Страница, открывшая Stakeward через `window.open`, могла позже подменить вкладку. Playwright 06.10.2026 против dev: вкладка ушла на адрес атакующего.
- Стало: `Cross-Origin-Opener-Policy: same-origin` в `apps/web/public/_headers` и явно в `security-headers.ts` (D86). На dev развёрнут, `verify-deploy` видит все пять заголовков.
- Тесты: `apps/worker/test/security-headers.test.ts`, `apps/worker/test/fakes.ts` на каждом маршруте API, Playwright `smoke.spec.ts` берёт заголовки из `_headers`.

### П5. Два ключа из одного кошелька (средний)

- Было: на /protect — Alert info о переключении аккаунтов; на /rescue проверки нет.
- Стало: `SecondKeyStep.tsx:78-86` — Alert warning `protect.second.sameWallet` («Accounts of one wallet app, and every account of one Ledger, usually come from one seed phrase…»). /rescue: `SameWalletWarning` на шагах New wallet, Keys и Move (`RescueWizard.tsx:115-128`), с учётом всех аккаунтов, что приложение показало на странице (`wizard.ts:130` `addOfferedAccounts`, `:156` `newWalletSharesWallet`). Путь из Telegram (`/rescue?address=`), где слоты ключей заполняются позже, тоже ловится (aa69c41).
- Тесты: `apps/web/test/protect.test.tsx` («one wallet holds both keys…»), `apps/web/test/rescue.test.tsx` (блок «a new wallet in the same wallet app as a key», 4 теста), `src/pages/rescue/wizard.test.ts`.

### П6. Смена staker вором выглядела как «сервис стейкинга» (низкий)

- Стало: `account-row.tsx:95` — на строке Protected или Expiring при staker ≠ withdrawer Alert warning `components.accountRow.stakeKeyChanged` («Another key can stop or move this stake. If you did not set this up, your main key may be stolen.») и Open Rescue на `/rescue?address=<основной ключ>` (/app, страницы аккаунта, «Готово»; на страницах спасения — без ссылки).
- Остаток: это работает там, где устройство знает второй ключ. На чужом устройстве такой аккаунт — Locked by another key с подсказкой о сервисе (D35); выручает тревога STAKER_CHANGED.
- Тесты: `src/components/product/account-row.test.tsx`, `apps/web/test/app-page.test.tsx` (настоящая смена staker на LiteSVM).

### П7. Непроверяемый Authorize(Withdrawer → X) в сети не проверен (низкий)

- Стало: `packages/core/test/errors.svm.test.ts:200-238`, программа mainnet v5.1.0 на LiteSVM, раскладки сгенерированная и legacy (Clock на индексе 1). Подпись одного основного ключа → CustodianMissing; основной ключ и чужой ключ в слоте хранителя → LockupInForce; аккаунт не меняется. Обещание FAQ `faq.items.thefts.a` подкреплено тестом. Код не менялся: это тест поведения программы.

### П8. Нет совета держать второй ключ только для Stakeward (низкий)

- Стало: `protect.second.onlyStakeward` на `SecondKeyStep.tsx:88` в обоих режимах и третий абзац FAQ good-second-key: «Use your second key only to co-sign Stakeward transactions; do not connect it to other sites… One signature on a fake site can hand your lock to a thief's key».
- Тесты: `apps/web/test/protect.test.tsx` (DW1, P-L1), `apps/web/test/landing.test.tsx`.

### П10. /start: общий суточный лимит закрывался одним аккаунтом (низкий)

- Было: счётчик `meta.link_writes` рос до записи, даже на повторной привязке, лимит один на все чаты.
- Стало: считаются только добавленные привязки (`LINK_COUNT` и `LINK_WALLET` под одним токеном, `apps/worker/src/monitor/store.ts:205-219`): 1000 в сутки на все чаты, 50 на чат. Уже привязанный кошелёк подтверждается без записи. Счётчик чата лежит под HMAC от дня и chat id (`linkCounterKey`, `monitor/store.ts:378-383`), сам chat id в meta не попадает; миграция 0004 убирает счётчики под сырым chat id (D90).
- Остаток: у ботов `can_join_groups` (В6) — один аккаунт Telegram с 20 группами всё ещё выбирает суточные 1000. Миграция 0004 не применена ни на dev, ни на prod.
- Тесты: `apps/worker/test/telegram/webhook.test.ts` (63), `test/monitor/store.test.ts` (36), `test/migrations.test.ts` («0004 drops the per-chat counts…»).

### П11. «Готово» обещало мониторинг, но без Telegram напоминаний нет (низкий)

- Стало: `DoneStep.tsx:214-219` — в карточке Telegram RiskNote `lock-ends` с T и `protect.done.telegram.noReminder` («Without Telegram alerts nobody reminds you before {date}.»). Файла .ics нет (было «по желанию»).
- Тест: `src/pages/protect/DoneStep.test.tsx`.

### П12. Часы кластера без сверки с часами устройства (низкий)

- Стало: `pages/protect/clock.ts:10` `MAX_CLOCK_SKEW_SECONDS = 86_400n`. /protect (`load.ts:65-82`, `PeriodStep.tsx:82`) и /extend (`account/load.ts:48`, `ExtendChoose.tsx:53-54`) при расхождении больше суток не считают T и показывают `ClockSkewError` с обоими временами и Try again. Порт `Ports.deviceClock` (D92). Потолок T не вводили: при сверке до суток T и так не дальше срока плюс сутки.
- Тесты: `src/pages/protect/clock.test.ts` (в том числе Clock из 2099), `test/protect.test.tsx` и `test/extend.test.tsx` (П12), `test/ports-react.test.tsx`.

### П13. Прокси пропускал вывод на любого получателя (низкий)

- Стало: `policyRefusal` (`apps/worker/src/rpc.ts:61-69`, вызов `:130-136`) после инспектора отклоняет Withdraw не на основной ключ (withdrawAuthority из байтов) и закрытие nonce не на его authority: -32602 «Transaction rejected by inspector: foreign-recipient», `data.check: 'policy'` (D91).
- Тест: `apps/worker/test/rpc.test.ts` («refuses %s with -32602 (foreign-recipient), on simulate and on send», «forwards %s»).

### П14. Подсказка защиты по ссылке обещала, что неверный адрес не подпишет (низкий)

- Стало: `protect.second.linkHint` — «Paste only the address of a wallet you or a person you trust created. Stakeward never gives you a second key address; whoever holds it can freeze this stake.» Комментарий кода `chosenSecondKey` (`pages/protect/wizard.ts`) поправлен в be57717.
- Тест: `apps/web/test/protect.test.tsx` (P-L1, `toHaveAccessibleDescription`).

### П15. Механизм подписи не проверял, что кошелёк подписал (низкий)

- Стало: `signing/session.ts:654-664` после каждого ответа кошелька требует адрес шага в `presentSignatures` (только действительные подписи, core `inspect.ts:343`) каждой транзакции, которую он подписывал; иначе остановка `verify` / `missing-signatures`, следующий ключ не спрашивается, ссылка не выдаётся (D93).
- Тесты: `apps/web/test/signing-session.svm.test.ts` (кошелёк вернул транзакции без подписи не на последнем шаге; подписал только часть), `test/signing-link.svm.test.ts` (без подписи до ссылки).

### П16. F5 мог попросить пополнить украденный основной ключ (низкий)

- Стало: `pages/extend/plan.ts:53-62` `feePayerFor` — основной ключ платит, только если `canPayFee` по его собственному балансу (порог — минимум без аренды плюс `networkFeeFor(2)`); иначе плательщик — второй ключ, и ошибка просит пополнить его. При нехватке SOL у плательщика симуляция называет ключ (`fee-balance`). При оплате основным — строка `extend.mainPaysStolen` (D93).
- Тесты: `apps/web/test/extend-plan.test.ts` (K = 0, A = 0 и граница), `test/extend.test.tsx` (E2a, E2d), `test/signing-session.svm.test.ts`.

### П20. Нестрогий `minimumReleaseAge` (средний)

- Стало: `pnpm-workspace.yaml` — `minimumReleaseAge: 1440` явно (включает strict), `trustPolicy: no-downgrade`, исключение только `semver@6.3.1` с причиной; старые исключения убраны в том же коммите c845aeb (D97). `pnpm config get`: 1440, no-downgrade. Проверка — frozen install в CI на a5f563c прошёл в `check` и `e2e`.

### П21. Нет расписания аудита (низкий)

- Стало: `.github/workflows/ci.yml` — задача `audit` раз в сутки в 05:17 UTC (frozen install и `pnpm audit`), `check` и `e2e` по расписанию пропускаются.
- GitHub запускает расписание только по ci.yml ветки по умолчанию. С 06.10.2026 main догнан до `build/product` (В7), так что суточный аудит идёт по main. Остаток за владельцем: Dependabot alerts не включены (В4).

### П23. URL запросов с адресами кошельков в логах Cloudflare (низкий)

- Стало: `apps/worker/wrangler.jsonc` — `observability`: логи включены, `redact_query_string: true`, `traces.enabled: false`, рядом комментарий, почему трассировки не включать (D95). Адресов в путях /api нет, только в query.
- Остаток: `invocation_logs` включены (было «по желанию»): IP, страна и путь без query пишутся. Не развёрнуто.
- Тест: `apps/worker/test/observability.review.test.ts` (dev и prod, конфиг так, как его разрешает wrangler).

### П25. Суточные пары вытеснялись чужими (низкий)

- Стало: отдельный круг `meta.pairs_sweep` с курсором по (withdrawer, custodian), страница `pairsPageRows` (100 free, 250 paid) встаёт в очередь, только пока очередь короче страницы; если потолок 1000 срезает пары, `withUrgent` (`pass.ts:821-842`) возвращает курсор назад (D88).
- Цена: круг больше не обрезан 1000 парами, при тысячах чужих пар — до 3 getProgramAccounts за проход весь день (около 21 600 кредитов Helius в сутки, П22).
- Тесты: `apps/worker/test/monitor/rescan.test.ts` (1001 чужая пара; круг через сутки; срочные пары сверх потолка; падения прохода), `store.test.ts`.

### П26. Нет независимой проверки состояния (нет)

- Стало: вопрос FAQ «How can I check my lock without Stakeward?» (`faq.items.check-explorer`): набрать explorer.solana.com руками, найти баннер «Account is locked! Lockup expires on <date>», сверить Lockup Authority Address (второй ключ) и Withdraw Authority Address (основной ключ); нет баннера — нет замка. Надписи взяты из исходников Solana Explorer (`StakeAccountSection.tsx`), на живой странице их сверяет владелец (TESTPLAN, шаг 8).
- Само ограничение остаётся архитектурным: браузер видит сеть только через свой домен (§3).
- Тест: `apps/web/test/landing.test.tsx`.

### П27. CI `check` падал на гонке блокхэша в тестовой обвязке (новый, средний для процесса)

- Было: `TestChain.setup()` (`packages/core/test/svm.ts`) брал свежий блокхэш и асинхронно подписывал. LiteSVM принимает только последний блокхэш, а тесты готовят аккаунты параллельно (`Promise.all([fundedKey(), createVoteAccount()])`): airdrop или другая подготовка в окне подписи давали `Setup transaction failed: BlockhashNotFound`. На медленном раннере CI это случалось часто: `check` красный на 93069ab (коммит только с документами) и на a5f563c. Локально воспроизведено на 4 ядрах (`taskset -c 0-3`): `withdraw.test.tsx` W2 упал в первом же прогоне.
- Стало: если блокхэш сдвинулся, пока шла подпись, подготовка подписывает заново на том блокхэше, что последний сейчас, и сама его не сдвигает: так две подготовки в полёте не сбивают друг друга. Не больше 10 подписей. Код продукта не менялся.
- Тесты: `packages/core/test/litesvm-smoke.test.ts` — «a setup transaction survives a blockhash that moves while it is being signed» (подписант сам сдвигает блокхэш во время подписи) и «two setup transactions signed at the same time both land». Оба падали с BlockhashNotFound: первый до исправления, второй — с первой версией исправления, которая на каждом повторе брала свежий блокхэш.

### П28. Обёртка отказала бы в деплое prod после суточного аудита (новый, низкий)

- Было: `scripts/deploy/ci.ts` считал провалом любой запуск задачи `check` не с `success`. Суточный запуск по расписанию ставит на HEAD main `check = skipped`, и `pnpm deploy:prod` такого коммита отказал бы до следующего коммита.
- Стало: пропущенный запуск не считается ни успехом, ни провалом; если `check` пропущен во всех запусках, деплой отказывает с отдельным текстом. Заодно: если GitHub сообщает больше запусков, чем пришло на странице (каждый суточный запуск на HEAD main добавляет три), деплой отказывает, а не пропускает непрочитанные.
- Тесты: `scripts/deploy/ci.test.ts` («a check job the daily scheduled run skipped neither passes nor blocks the push run», «refuses a commit whose every check job was skipped: nothing checked it», «more check runs than one page holds is a problem…»).

## Открытые пробелы

| | Пробел | Тяжесть | Что сделано | Что осталось и почему |
|---|---|---|---|---|
| П4 | Дробление через Split: Split нужен только staker, каждая часть наследует замок. Вор дробит стейк на сотни частей; спасение — до 10 аккаунтов за прогон, на nonce по одной транзакции, 3 подписи на аккаунт; пакетного продления нет. Что не успели до T, вор выводит | средний | Лендинг («What Stakeward cannot do», `landing.cannotDo.items.split`) и FAQ main-stolen говорят про дробление и предел 10 (число из `MAX_RESCUE_ACCOUNTS`) | «Extend all» на /app (до 10 SetLockup одним запросом ко второму ключу) и отдельная тревога на массовый Split не сделаны. Пакетное спасение по блокхэшу меняет F4.3 — решение владельца (В9). CPU воркера на пыли не проверялся |
| П9 | Тревога LOCKUP_CHANGED ведёт на /app, а не к действию | низкий | Тесты на LiteSVM: второй ключ один не выводит и не меняет основной ключ; после передачи замка X вывод A+K падает | Если дату сдвинул второй ключ при прежнем хранителе и прежний замок действовал — текст «remove the lock with your second key now, then protect again» и кнопка на `/extend/<account>?remove` (страница этот параметр уже понимает). Нужна ветка в core `formatAlert` и правка `diff.test.ts:382` |
| П17 | Перехват вебхука украденным токеном бота | средний | Каждый проход `getWebhookInfo`, раз в сутки `getMe`; чужой или пустой URL, свежий 401 или чужой бот — тревога bot-mismatch с порядком ротации (D89). Порядок ротации записан в TESTPLAN «Шаг 5», б | Проходы идут по расписанию `*/2`: вор может возвращать наш URL на секунды вокруг проверки. Описания ботов (там домен) не проверяются. Сообщения пользователям после ротации нет. При неверном `SITE_ORIGIN` сверка URL пропускается (это и так сломанный деплой). Защита аккаунта Telegram — владелец (В3) |
| П18 | Целостность деплоя | средний | Обёртка `scripts/deploy.ts`: чистое дерево, HEAD == origin, для prod зелёный `check`, frozen install, guard-тесты на выгружаемой папке, запись sha256 в `docs/deploys.md`; `pnpm verify-deploy` сверяет файлы и заголовки с коммитом (D96) | Хеша кода воркера нет (его собирает wrangler). Dev не ждёт CI, есть `--allow-unpushed` и аварийный `deploy:dev:raw`. Prod через обёртку ещё ни разу не выкатывался |
| П19 | Секреты деплоя видны зависимостям сборки | средний | Сборка и guard-тесты идут с окружением из белого списка; токен и id аккаунта Cloudflare обёртка читает сама и отдаёт только `wrangler deploy`; оболочку с экспортированными секретами отклоняет. Файл секретов больше нигде не подключается в рабочую оболочку: `set -a` остался только внутри подоболочек `( … )`, которые передают команде через `env -i` два ключа Cloudflare (D96, TESTPLAN «Шаг 5», б). Миграции — подоболочкой с двумя ключами (D96) | Код сборки видит HOME и может прочитать файл секретов с диска: в `~/.config/stakeward/secrets.env` пока лежат токены ботов и ключ Helius, рядом `dev.vars` и `prod.vars`. Убрать их, токен Cloudflare выпускать с коротким сроком — владелец (В3) |
| П22 | Лимит частоты /api/rpc: привязка Cloudflare согласована по локациям; с одного IP прошло 338 из 339 запросов за 15 с (~22 rps при настройке 3 rps). Скрипт выжигает 10 rps Helius, а через `/api/stake-accounts` (gPA по 10 кредитов, без кэша на workers.dev, D39) — 1 млн кредитов за полдня; монитор ходит в тот же Helius — тревоги встанут у всех. П25 добавил до 21 600 кредитов в сутки на круг пар | средний | — | Отдельный ключ RPC для монитора (В8); общий лимит на втором binding ниже rps Helius; лимиты на IP с поправкой на слабость привязки; кэш gPA на своём домене; нагрузочный тест на 429 |
| П24 | Домен: описание prod-бота называет prod-адрес, README — нет (D84) | низкий | — | Решение владельца (В2): называть ли prod до шага 9; перед пользователями вписать домен в README; повторить при переезде на свой домен |

Ещё одно следствие П1: 1000 напоминаний такой атаки за сутки занимают окно ожидающих событий (100 за проход) и задерживают чужие тревоги примерно на 10 проходов, около 20 минут. Привязанного чата у этих событий нет, они закрываются без отправки.

## За владельцем

- **В1. Мониторинг на mainnet.** Решение владельца 06.10.2026: пока остаёмся на Workers Free. Если CPU проходов подойдёт к 10 мс, говорю владельцу (§8); вариант — Workers Paid за 5 долларов. Замеры: пустой проход cron — 7–8 мс CPU из 10, проход с 20 декодированиями — 10–15 мс, на free лимит снижен до 8 декодирований (D63). С 06.10.2026 каждый проход ещё делает `getWebhookInfo` (D89): CPU перемерить после деплоя. Пройти TESTPLAN «Шаг 5» в): настоящая тревога после Deactivate, LOCKUP_CHANGED после продления. После деплоя новой сборки в prod проверить `/api/health` (06.10.2026 02:49 UTC старая сборка prod отвечала 200, последний проход 02:48:32 UTC).
- **В2. Домен.** Купить короткий домен (§3 требует его с первого дня), вписать в README и описания ботов, пройти форму Phantom. В зоне включить Always Use HTTPS (потом HSTS preload) и выключить Network Error Logging. До этого решить П24.
- **В3. Доступы.** 2FA на Cloudflare, GitHub и аккаунте Telegram, который владеет ботами. Токен Cloudflare с минимальными правами и сроком жизни, отзывать после деплоя. В `~/.config/stakeward/secrets.env` на VPS оставить только `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID` (токены ботов и ключ Helius уже в секретах Cloudflare), удалить `dev.vars` и `prod.vars` (П19). Блок регистрации бота в TESTPLAN «Шаг 5», б читает эти файлы, а секрет вебхука из Cloudflare не прочитать: при переезде на свой домен (В2) токен вводить вручную и выпустить новый секрет вебхука по шагам ротации там же. Защита ветки main и запрет force-push.
- **В4. Dependabot alerts** в настройках GitHub.
- **В5. Preview-адреса prod.** У `stakeward-prod` `previews_enabled: true`: `https://037f86ff-stakeward-prod.zhibul-alexander.workers.dev/` отдаёт приложение с базой и секретами prod. В конфиге уже `preview_urls: false`, вступит со следующим деплоем prod; сразу — выключить в панели. После деплоя проверить, что старый адрес не открывается. У dev выключено.
- **В6. Боты в группах.** `can_join_groups: true` у обоих: в группе любой участник может сделать `/stop`, список кошельков виден группе, а 20 групп одного аккаунта выбирают суточный лимит /start (П10). BotFather `/setjoingroups` → Disable.
- **В7. Слить build/product в main** — сделано 06.10.2026 по слову владельца: main перемотан (fast-forward) до `build/product`. Ссылки сайта на README («Recover without Stakeward») и docs/gate.md и суточный аудит по расписанию (П21) теперь идут по актуальному коду. Дальше main догоняется вместе с `build/product` перед каждым деплоем prod.
- **В8. Второй ключ Helius** (или платный план) только для монитора, чтобы прокси не мог выжечь кредиты тревог (П22).
- **В9. Решение по F4.3**: разрешить спасение пачкой по блокхэшу, когда A, D и K подключены в одном браузере (П4).

## Чем проверено

Обновление 06.10.2026 (a5f563c плюс исправления П27, П28):
- Сверка 23 пробелов шестью агентами по коду и тестам: 12 файлов сайта (protect 17, extend 12, rescue 8, app-page 19, signing-session 26, signing-link 29, landing 20 и др.), core `errors.svm.test.ts` 21 и `diff.test.ts` 57, воркер 313 тестов в 16 файлах (webhook 63, rpc 97, store 36, rescan 32, bot-check 10 и др.), сайт `prebuilt` и `vite-env` 6 из 6, guard-тесты 12 и 1 пропуск. Все прошли с первого раза.
- `TZ=UTC CI=true pnpm test` на a5f563c: core 788, scripts 127, web 786 и 1 пропуск, worker 598. То же на свежем клоне без `apps/web/dist`, с пустым HOME и без git-конфига — зелёное.
- CI GitHub: `check` красный на a5f563c и 93069ab на шаге `pnpm test` при 63 и 86 с (зелёные прогоны — 127–153 с). Лог без входа в GitHub не прочитать (API без токена отвечает 403), токена GitHub у сессии нет. Причину нашёл прогон тестов сайта на 4 ядрах (`taskset -c 0-3`): BlockhashNotFound в подготовке LiteSVM (П27), W2 и W3f из `withdraw.test.tsx` за три прогона.
- С исправлениями П27 и П28: тот же цикл на 4 ядрах — 6 прогонов из 6 без падений; `packages/core/test/litesvm-smoke.test.ts` 5 из 5 пять раз подряд; `scripts/deploy` 68 из 68; полный прогон — в docs/PROGRESS.md, шаг 11.
- Изменения этого обновления (документы и исправления П27, П28) прошли отдельную проверку фактов шестью агентами; 52 замечания учтены.

Первый проход (06.10.2026, bcc1170):
- `apps/worker`: reminders, store, security-headers — 46 из 46; `apps/web`: landing — 18 из 18. `pnpm audit` — No known vulnerabilities found.
- curl 02:49 UTC: `/app` на dev и prod — CSP из §11, COOP ещё нет; `/api/health` на dev и prod — 200.
- Аудит до исправлений: core lockup, status, diff, inspect, watch — 230 из 230; worker reminders и store — 88 из 88; web signing, cosign, rescue, link — 81 из 81; build-output и test-code-guard — 12 из 12. Живые пробы dev и prod: заголовки на всех маршрутах и ассетах, /api/rpc (методы вне списка → -32601, неверные параметры → -32602, 415, 413, отказ инспектора на чужих транзакциях), лимит частоты, вебхук 401. Через API Cloudflare и Telegram читались настройки воркеров, привязки секретов, `getWebhookInfo`, `getMe`, описания ботов; getAccountInfo программы Lighthouse в mainnet.

## Для ведущего

- Дождаться зелёного `check` на HEAD после пуша исправлений П27 и П28 (на a5f563c он красный).
- С разрешения владельца: `pnpm deploy:dev`, коммит и push `docs/deploys.md`, миграция 0004 на dev (DECISIONS D96), `pnpm verify-deploy --env dev --commit <sha>`, в `wrangler tail` — CPU прохода с `getWebhookInfo` и страницей напоминаний.
- Prod — только по решению владельца, с main, догнанным до `build/product` (В7), и после зелёного `check` на HEAD: `pnpm deploy:prod --prod-confirm`, коммит и push `docs/deploys.md`, миграция 0004 на prod, `pnpm verify-deploy --env prod --commit <sha>`, проверка старого preview-адреса (В5).
- Код: П9 (кнопка снятия замка в тревоге LOCKUP_CHANGED), П4 «Extend all» и тревога на массовый Split — если владелец согласен; П22 — лимиты, когда будет второй ключ RPC.
