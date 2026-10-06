# Проверка безопасности

Проход по CLAUDE.md §11 от 06.10.2026: каждая угроза и каждое обязательное правило со статусом и доказательством. Проверялась ветка `build/web` на коммите bcc1170 (равна `build/product`) вместе с незакоммиченными исправлениями этого прохода. Источники: чтение кода и тестов, прогоны тестов, curl по dev и prod, чтение настроек Cloudflare и ботов Telegram через API (без изменений), чтение программы Lighthouse в mainnet. Спорные пробелы проверял отдельный агент, который пытался их опровергнуть. Prod не трогали.

Статусы:
- **выполнено** — правило работает, доказательство приведено;
- **пробел исправлен** — пробел найден и исправлен 06.10.2026 с тестом, который до исправления падал. Исправления не закоммичены и не развёрнуты;
- **открыт** — пробел найден, не исправлен; в таблице «Открытые пробелы» сказано, почему он остаётся и что сделать;
- **за владельцем** — сделать может только владелец (аккаунты, деньги, решения по модели безопасности по §15).

## Итог

- Обязательные правила §11 выполнены, кроме одного: README не называет домен prod (D84, решение владельца, О7). Механизм замка держит в сети на трёх кластерах всё, что обещает продукт: вор с одним основным ключом не выводит SOL, не меняет право вывода и не трогает замок.
- Три пробела исправлены: напоминания можно было заглушить чужими замками (П1, средний), лендинг обещал «hacked or down → lose alerts, not SOL» (П2), у страниц не было Cross-Origin-Opener-Policy (П3).
- Открыто 23 пробела, из них 7 средних: дробление через Split (П4), один кошелёк для двух ключей (П5), перехват вебхука бота (П17), целостность деплоя (П18), секреты деплоя в окружении сборки (П19), нестрогий `minimumReleaseAge` (П20), общий Helius у прокси и монитора (П22).
- По-моему, до первых пользователей на mainnet (шаг 9) нужно развернуть П1–П3, закрыть П5, П17, П19, П20, П22 и сделать В1–В3. Остальное можно после.

## Угрозы

### У1. Кража основного ключа — выполнено; открыты П4, П6, П16

- Замок в сети: docs/gate.md, проверки 3 (Withdraw одним A → LockupInForce), 4 (AuthorizeChecked(Withdrawer → X) с A и X → CustodianMissing), 5 (SetLockup от A при действующем замке → MissingRequiredSignature), 8b (Split копирует замок, Withdraw из S2 → LockupInForce), 14a. LiteSVM 24 из 24, devnet 21 из 21, mainnet 8 из 8. `scripts/gate/gate.test.ts` гоняет план в CI. Правило замка — core `lockup.ts` `isLockupInForce`.
- Спасение F4: `packages/core/src/builders.ts:117-122` собирает спасение только с плательщиком D и nonce у D; инспектор проверяет это контрольной пересборкой. Мастер: `apps/web/src/pages/rescue/wizard.ts` `newWalletProblems` (D не основной ключ, не второй ключ, не стейк-аккаунт, не нулевой), галочка новой seed-фразы, проверка баланса D. Тесты `apps/web/test/rescue.test.tsx`: вор сменил staker и снял с делегирования (`core/test/thief.ts`), второй ключ по ссылке, Split во время прогона находится через «Look again». gate 11a–c, 12b.
- Тревоги DEACTIVATED, STAKER_CHANGED, DELEGATION_CHANGED ведут на «Open Rescue» (core `diff.ts:291-314`, D73). Предупреждение «do not withdraw to it, use Rescue» стоит на /withdraw до подписи (`WithdrawPage.tsx:138`).
- Чего замок не даёт: вор может дробить, снимать с делегирования и менять staker. Отсюда П4 и П6.

### У2. Фишинговая транзакция со скрытым Authorize — выполнено; открыт П7

- В сети: gate 4 (CustodianMissing) на LiteSVM, devnet и mainnet.
- Stakeward такую транзакцию не соберёт и не пропустит. Инспектор принимает AuthorizeChecked только парой спасения; одиночный AuthorizeChecked и непроверяемый Authorize → `unknown-instruction` (`packages/core/src/inspect.test.ts:535`). Прокси: `apps/worker/test/rpc.test.ts:197-299` (перевод System → -32602, неподписанная или подписанная одним A → -32003). Живая проба 06.10.2026 на dev и prod: TransferSol, SetLockupChecked с дописанным переводом, Authorize(Withdrawer), Split и мусор отклонены инспектором.
- Хвост Lighthouse: программа `L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95` в mainnet неизменяемая — programdata `CJ5WEjifs4d77pEA9DpewppByFjHcAkNv3YYSuSoDk7c`, authority null (слоты 453762273 и 453762471). Вопрос D24 «кто может обновлять Lighthouse» закрыт. `checkSigningStep` пускает хвост только на неподписанную транзакцию и без новых подписантов и записываемых аккаунтов (`verify.ts:109-125`).

### У3. Кража второго ключа — выполнено; открыты П8, П9

- Вывод и спасение без основного ключа не собираются: в `builders.ts` withdraw и rescue подписывает mainKey. Второй ключ никогда не владеет nonce (D67). Если у второго ключа нет SOL, F5 переводит оплату на основной ключ (`canPayFee`, `extend.test.tsx:120`).
- Ограничение названо прямо: RiskNote `second-key-can-freeze` на `SecondKeyStep.tsx:82` и `CosignSigning.tsx:178`, `landing.cannotDo.items.freeze`, `recovery.cases.stolenSecond`, FAQ second-stolen.
- Тревога «your second key may be stolen» при смене хранителя: `diff.ts:343-346`, `diff.test.ts:269, 387`.

### У4. Оба ключа из одной seed-фразы — выполнено; открыт П5 (средний)

- core `validateSecondKey` (`lockup.test.ts:113-122`): второй ключ не равен основному, staker, стейк-аккаунту и нулевому ключу.
- Мастер не идёт дальше без галочки «My second key comes from a different seed phrase» (`protect.test.tsx:599-656`). Слот второго ключа не принимает основной (D35). У нового кошелька при спасении своя галочка (`rescue.newWallet.seedCheck`).
- Тексты: `protect.second.seedHint`, FAQ different-seed и good-second-key, `landing.cannotDo.items.sameSeed`, `recovery.limits.sameSeed`.

### У5. Забытое продление — пробел исправлен (П1); открыты П10, П11; за владельцем В1

- Напоминания за 30, 14, 7, 3 и 1 день (core `REMINDER_DAYS`, `reminderDue`, ссылка на /extend/:account), EXPIRED один раз (`events.test.ts:189`), Expiring меньше 30 дней (`status.test.ts:62-63`), красный баннер F6 (`app-page.test.tsx`, `app/view.test.ts`, `app-f6-memory.review.test.tsx`), дата до подписи (PeriodStep «Locked until {date}», RiskNote lose-second-key).
- П1: суточная выборка напоминаний брала первые 1000 строк, и чужие дешёвые замки вытесняли из неё всех остальных. Исправлено.
- Доставку настоящей тревоги в Telegram владелец ещё не проверил (TESTPLAN «Шаг 5», пункт в).

### У6. Взломанный сайт или сервер Stakeward — пробел исправлен (П2); открыты П12, П13, П18, П19, П22, П26

- Лежащий сервер: пропадают сайт и тревоги, SOL нет — замок живёт в стейк-программе, команды CLI с карточки работают без Stakeward (docs/recovery-cli.md, 26 из 26 на тест-валидаторе).
- Взломанный API или Helius при целой статике деньги не перенаправит. Байты собирает браузер, сводку панель строит из них (`apps/web/src/signing/session.ts:620` `checkSigningStep`, `:641` и `:889` `inspectTransaction`, `:653` `verifyAllSignatures`). Второй ключ и D берутся только из подключённых кошельков или введённого адреса, получатель вывода — всегда основной ключ (D64). Ложные ответы RPC ломают транзакцию, но не меняют адреса. Остаточный риск — П12 и П26.
- Взломанный деплой (аккаунт Cloudflare, токен деплоя, VPS) — это взломанный сайт: подменённый код может попросить вредную подпись, и инспектор в нём тоже подменён. Кодом это не закрывается. Защита — то, что показывает кошелёк или Ledger (New authority, To), открытый код и тексты: лендинг `landing.security.items.site`, README «If Stakeward were hacked». Отсюда П18 и П19.
- П2: лендинг обещал «If it is hacked or down, you lose alerts, not SOL». Это верно только для «down». Исправлено.

### У7. Украденный токен Telegram-бота — выполнено; открыт П17 (средний); за владельцем В2, В6

- Токен только в секретах воркера и в URL запроса к Telegram, в лог не пишется (`apps/worker/src/telegram/api.ts`).
- Кнопка тревоги ведёт только на `SITE_ORIGIN`: `siteUrl` отклоняет путь без `/`, `//` и чужой origin (`api.ts:63-67`, `test/telegram/api.test.ts:58-68`); `SITE_ORIGIN` принимается только точным https-origin (`monitor/config.ts`). Сообщения без `parse_mode`, превью ссылок выключено, кнопок с callback нет.
- Вебхук: секрет сравнивается в постоянное время до чтения тела и D1 (`webhook.ts`, `webhook.test.ts:137`). 06.10.2026 на dev и prod чужой секрет получает 401; `getWebhookInfo` обоих ботов — верный url, очередь пуста.
- Chat id хранятся только в D1, через Bot API их не узнать. Но с токеном вор перенаправит вебхук на себя, и мы этого не заметим (П17).

### У8. Фишинговая ссылка /cosign держателю второго ключа — выполнено

- Фрагмент `#tx=` не уходит на сервер, плюс `Referrer-Policy: no-referrer`.
- До чтения сети `readLink` (`pages/cosign/read.ts:27-34`) прогоняет инспектор и core `cosignLinkProblem`: только protect, withdraw и rescue; только на nonce плательщика; плательщик ожидаемый и уже подписал проверенной подписью; withdraw только на основной ключ.
- По сети (`pages/cosign/plan.ts`): done, not-found, link-used, stale (withdrawer не основной ключ), already-locked (protect поверх действующего замка, иначе вор с A мог бы через ссылку поставить раннюю дату).
- Withdraw и rescue: красное предупреждение с полным адресом получателя или D, текст «A thief who has the main key would send you exactly this request», обязательная галочка. Тесты `apps/web/test/cosign.test.tsx:136-260`, `rescue.test.tsx:376-389`, e2e `smoke.spec.ts:183` (`/cosign#tx=@@`).
- Остаётся социальная инженерия: вор с A присылает настоящую ссылку на вывод на A или на спасение на своего D. Формально она верна; держится на тексте и галочке, сильнее продуктом не сделать.

### У9. Поддельный сайт ставит хранителем вора — пробел исправлен (П3); открыт П14; за владельцем В2

- Настоящий /app показывает хранителя, которого нет среди известных вторых ключей, как «Locked by another key» (core `status.ts:82`, D35). Известные ключи лежат в localStorage настоящего origin, чужой сайт туда не пишет. Тесты `apps/web/src/pages/app/view.review.test.ts:8-40`, `apps/web/test/app-ux.review.test.tsx:150-162`. FAQ fake-site: закладка, поле New authority на Ledger, «Locked by another key».
- П3: фишинговая страница, открывшая Stakeward через `window.open`, могла позже подменить эту вкладку на копию. Проверено Playwright на dev до исправления: вкладка ушла на чужой адрес. Исправлено.
- Независимой опоры «вот настоящий домен» пока нет: README не называет prod, домен временный (В2, П24).

### У10. Подмена зависимости в npm — выполнено; открыты П19, П20 (средние), П21

- Точные версии во всех package.json, `workspace:*` для своих пакетов, `savePrefix: ''`. В pnpm-lock.yaml нет git, tarball и чужих registry, 567 записей integrity. Install-скрипты разрешены только esbuild и workerd (`allowBuilds`).
- CI (`.github/workflows/ci.yml`): `pnpm install --frozen-lockfile`, `pnpm audit`, действия закреплены по SHA, `persist-credentials: false`, `permissions: contents: read`.
- `pnpm audit` 06.10.2026: «No known vulnerabilities found».
- Бандл сайта ограничен CSP `connect-src 'self'`: подменённая зависимость в бандле может слать транзакции только через /api/rpc, а там инспектор (П13 — что ещё можно ужесточить).

## Обязательные правила

### О1. Экран подписи показывает сводку инспектора по тем самым байтам; подписанная транзакция проверяется по §6 — выполнено; открыт П15

- Свои сборки: `session.ts:380-383` собирает байты, `inspectOwn` (`:902-912`) требует, чтобы инспектор прочитал из них то же действие и того же плательщика. Байты /cosign идут через `readLink` и `inspectBytes` (`session.ts:888-899`). После каждого кошелька байты читаются заново и сводка на экране заменяется (`:638-649`). `SigningPanel.tsx` рисует только `state.round.txs[].summary`.
- Все пути подписи используют `PageSigningPanel` поверх `createPageSession`: protect, withdraw и deactivate, extend и unlock, rescue, delegate, создание и закрытие nonce (с отменой ссылки), /cosign. Единственный вызов `wallet.signTransactions` в продукте — `session.ts:582`.
- §6: `checkSigningStep` после каждой подписи по всем транзакциям этапа, первое расхождение останавливает этап (`session.ts:617-636`); `verifyAllSignatures` перед каждой отправкой (`:651-659`); в режиме ссылки `cosignLinkProblem` до показа ссылки. В `sending` ведёт только событие `signed` после этих проверок (`machine.ts:339`). Буферы копируются в обе стороны (`ports/wallet-standard.ts:142, 159`). Прокси повторяет проверку (`apps/worker/src/rpc.ts:93-109`).
- Прогон 06.10.2026 (аудит): `apps/web` `vitest run test/signing-session.svm.test.ts test/cosign.test.tsx test/rescue.test.tsx test/link.test.tsx test/signing-link.svm.test.ts` — 5 файлов, 81 из 81.

### О2. При спасении новый владелец — подключённый D, адрес целиком, D подписывает — выполнено

- D берётся только из слота New wallet, когда подключённый кошелёк отдаёт этот аккаунт (`RescueWizard.tsx:99`, `ports/slots.ts:87`), и фиксируется в прогоне (`:259`).
- Адрес целиком: `MoveStep.tsx:43-44` до подписи, сводка «Controlled by: Main key -> New wallet» и список подписантов (`transaction-summary.tsx:179-205, 359-365`).
- Инспектор принимает только пару AuthorizeChecked, где новый владелец обязан подписать (`inspect.ts:468`, `rescueAction` `:799`). D всегда подписывает на этом устройстве: `checkLinkPlan` отклоняет план, где D — удалённый подписант (`session.ts:879-885`). /cosign для спасения показывает D целиком с обязательной галочкой.

### О3. Скомпрометированный ключ не платит комиссию и не владеет nonce — выполнено; открыт П16

- Спасение: сборщик отказывает, если плательщик или владелец nonce не D (`builders.ts:117-121`); инспектор пересобирает каждое сообщение этим сборщиком, поэтому прокси и /cosign отклоняют другого плательщика. `expectedFeePayer` для спасения — D (`actions.ts:145-162`). Делегирование после спасения, создание и закрытие nonce платит D.
- Захват выведенного адреса nonce (его может заранее пополнить кто угодно) даёт отказ `unusable`, экран просит подключить другой новый кошелёк (`nonce.blockedRescue`).
- П16: запасной путь F5 может попросить пополнить украденный основной ключ.

### О4. Заголовки на всех ответах, без сторонних скриптов, шрифтов и аналитики — пробел исправлен (П3); за владельцем В2, В5

- Статика: `apps/web/public/_headers`. curl 06.10.2026 по dev и prod (`/`, все маршруты §9, 404, SPA-фолбэк, редирект `/index.html`, каждый файл `/assets`): ровно CSP из §11 (`default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`. В index.html нет inline-скриптов и стилей.
- /api: `apps/worker/src/security-headers.ts` для каждого маршрута, включая ошибки (404, 413, 415, 401, 302); те же значения плюс X-Frame-Options DENY и COOP. `apps/worker/test/security-headers.test.ts` и `e2e/smoke.spec.ts:241-243` держат их одинаковыми.
- `style-src-attr` не понадобился: Radix-примитивы со `<style>` не используются (D3, D29).
- Сторонних скриптов, шрифтов и аналитики в mainnet-бандле нет: внешние URL — только эксплорер, GitHub, docs.anza.xyz и release.anza.xyz (текст команды на карточке), служебные ссылки React и Tailwind. Шрифты — 11 своих woff2. Сеть — только `/api/*`.
- П3: COOP `same-origin` добавлен на страницы. В §11 его нет; добавлен сверх списка против подмены вкладки.
- HTTP без редиректа: `http://…workers.dev/app` отдаёт 200. Сейчас не важно (вся зона .dev в HSTS preload), станет важно на своём домене (В2).
- Cloudflare добавляет ко всем ответам `report-to`/`nel` на a.nel.cloudflare.com: при сетевых сбоях браузер шлёт туда URL страницы с query (`/app?address=…`, без `#tx`). На workers.dev не отключить; на своём домене — настройка зоны (В2).

### О5. Нет dangerouslySetInnerHTML; всё из сети и ссылки выводится текстом — выполнено

- grep по `apps/web/src`, `apps/worker/src`, `packages/core/src` на dangerouslySetInnerHTML, innerHTML, outerHTML, insertAdjacentHTML, document.write, new Function, eval(, srcdoc, createContextualFragment, DOMParser — пусто. ESLint запрещает проп (`eslint.config.js:40-44`).
- `t()` — замена строк, вывод JSX-текстом; рендереров markdown и HTML среди зависимостей нет. Динамические href — проверенные адреса или константы, `explorerUrl` кодирует значение. CSP без `unsafe-inline` блокирует `javascript:`. Фрагмент /cosign разбирается строго (`link.ts` `decodeBase64Url`: каноничность, не больше 1232 байт).

### О6. Зависимости: точные версии, frozen lockfile, pnpm audit в CI, обновление — отдельный коммит — выполнено; открыты П20, П21

- См. У10. Обновлений версий пока не было: lockfile менялся в 6 коммитах, каждый добавлял новые зависимости со строкой в DECISIONS «Зависимости», ни одна существующая версия не поднималась.

### О7. В тревогах ссылки только на домен Stakeward; домен в README и в описании бота — ссылки выполнено; домен за владельцем (В2); открыт П24

- Ссылки: см. У7. Доставка 06.10.2026: `/api/telegram/link` отвечает 302 на своего бота (`stakeward_dev_bot`, `stakeward_bot`); `evil`, CRLF, обход пути и нулевой адрес — 400.
- Описания ботов называют свои адреса (dev — `https://stakeward-dev.zhibul-alexander.workers.dev`, prod — `https://stakeward-prod.zhibul-alexander.workers.dev`) и «never asks for your seed phrase». README называет только dev (README.md:7, :437): адрес prod не публикуется до шага 9 (D84).

### О8. В сборке сайта нет секретов; ключ Helius и токен бота в секретах воркера — выполнено; открыты П19, П23

- Поиск по шаблонам (api-key, helius, токен бота `\d{8,10}:[A-Za-z0-9_-]{35}`, RPC_URL, TELEGRAM_*, ADMIN_CHAT_ID, BEGIN PRIVATE) в свежей mainnet-сборке и в живых бандлах dev и prod — только ложные срабатывания.
- Точные значения CLOUDFLARE_API_TOKEN, HELIUS_API_KEY, токенов ботов, ADMIN_CHAT_ID и секретов вебхуков (сравнение без вывода) не найдены ни в сборках, ни в исходниках, ни в docs; `git grep -F` по всем 98 коммитам — 0. В Cloudflare RPC_URL, TELEGRAM_* и ADMIN_CHAT_ID лежат как `secret_text`.
- Код не пишет в лог URL с ключом или токеном. Трассировки выключены, поэтому URL подзапросов не записываются. Включать их нельзя без маскировки (П23).

### О9. Нет полей и путей кода для seed-фраз и приватных ключей вне scripts/ и тестов; тестового кошелька нет в prod — выполнено

- grep без учёта регистра по отслеживаемым файлам вне scripts/ и тестов на mnemonic, secret_key, private_key, keypair, fromSecretKey, createKeyPairFromBytes, createKeyPairSignerFromBytes, generateKeyPair, importKey, pkcs8, bip39, derivePath: только тексты «never asks for your seed phrase», комментарии и сгенерированные типы воркера.
- Поля ввода: `signing/AddressField.tsx` и `pages/app/AddressForm.tsx` (публичный адрес, только если проходит `isAddress`), демо на /dev/ui, поле ссылки только для чтения. localStorage хранит только адреса. `.gitignore` закрывает `.env*`, `.dev.vars*`, `.keys/`.
- `apps/web` `vitest run test/build-output.test.ts test/test-code-guard.test.ts` — 12 из 12 (06.10.2026, аудит). Guard собирает mainnet и ищет метки двойников, litesvm, generateKey, pkcs8, `solana:signMessage`, `solana:signIn`, у каждого двойника положительный контроль. Живые бандлы dev и prod этих меток не содержат. `importKey` в бандле — только импорт публичного Ed25519 для проверки подписи.

### О10. Репозиторий открыт (MIT), «No warranty» в подвале и README — выполнено; за владельцем В7

- `SiteFooter.tsx` на каждом маршруте: «No warranty. MIT license.», строка есть в живых бандлах dev и prod. README.md:451-457, LICENSE (MIT), `license: MIT` во всех package.json. github.com/Zhibul-Alexander/stakeward отвечает 200.
- Ссылки сайта ведут на ветку main (`config.ts:23-29`): `#recover-without-stakeward`, `blob/main/docs/gate.md`. На origin/main раздела «Recover without Stakeward» ещё нет (В7).

## Исправлено 06.10.2026

Все три исправления — в рабочей копии `build/web`, не закоммичены. Dev не перевыкачен, prod не трогали.

### П1. Суточная выборка напоминаний вытеснялась чужими замками (средний)

- Было: `DAILY_REMINDER_ROWS` брал `ORDER BY lock_until LIMIT 1000` без фильтра по `last_reminder_days` и без курсора; суточный этап закрывался после одной выборки. `/api/watch` не ограничивает число строк (D49). Атака: 1000 стейк-аккаунтов со своим хранителем и концом замка чуть раньше нужного (залог около 1,7–2,3 SOL, возвратный), 50 запросов `/api/watch` — и ни один пользователь с более поздним концом не получает напоминаний. Каждый день сдвигая свои замки через SetLockup, атакующий глушил напоминания всем. Воспроизведено точным SQL на node:sqlite с миграциями репозитория: «rows 1000, victim included false».
- Стало:
  - `apps/worker/src/monitor/store.ts`: выборка берёт только строки, где напоминание положено (`CASE` повторяет core `reminderDue`), листается по `stake_account` после курсора, `LIMIT ?3`; план запроса идёт по индексу первичного ключа, миграция не нужна;
  - `apps/worker/src/monitor/pass.ts`: одна страница за проход; полная страница пишет `meta.daily_sweep = {day, after}` в том же batch, что события, и следующий проход продолжает с курсора; `daily_day` пишется только после неполной страницы; незакрытый этап продолжается в любой час, в том числе после полуночи;
  - `config.ts`: `reminderPageRows` — free 250, paid 1000; `budget.ts`: `COST.daily` 5 вместо 4.
- Тесты: `apps/worker/test/monitor/reminders.test.ts` — 1000 замков с отправленным напоминанием плюс жертва (до исправления `reminders: 0`), 1001 напоминание к одному утру (ровно 5 проходов, каждое по разу, `DAILY_PAIRS` один раз), проход, упавший после полной страницы, этап через полночь. `store.test.ts` — курсор и совпадение SQL с `reminderDue` на 108 сочетаниях у границ порогов. Тот же сценарий на node:sqlite с новым SQL: «rows 1, victim included true».
- Не замерено: CPU страницы из 250 строк на Cloudflare. Число выбрано под лимит 10 мс по оценке.

### П2. «If it is hacked or down, you lose alerts, not SOL» (средний по аудиту, низкий по проверке)

- Сайт и API отдаёт один Worker (`wrangler.jsonc`: `assets.directory ../web/dist`, `run_worker_first ["/api/*"]`). Взломанный деплой меняет и JS сайта, то есть это взломанный сайт (У6). Фраза была верна только для «down» и спорила с соседним пунктом лендинга.
- `apps/web/src/i18n/en.json:237`, теперь: «If it is down, you lose alerts, not SOL. The same server delivers this website, so a hacked server means a hacked website: see the next point.» Тест `apps/web/test/landing.test.tsx` («promises "alerts, not SOL" only for a server that is down…») падал на старой фразе.
- README (правка ведущего, не закоммичена) уже говорит «If the server is down» (README.md:107) и имеет раздел «If Stakeward were hacked» (:111).
- Осталось: docs/SUBMISSION.md:109 ещё пишет «down or hacked, users lose alerts, not SOL»; CLAUDE.md §2.6 утверждает то же — расхождение записать в DECISIONS.

### П3. Нет Cross-Origin-Opener-Policy на страницах (низкий)

- COOP стоял только на /api (умолчание Hono, D10), где он ничего не даёт. Страница, открывшая Stakeward через `window.open`, могла позже подменить вкладку (`w.location = …`) уже после того, как пользователь проверил адрес. Playwright 06.10.2026 против dev: вкладка ушла на адрес атакующего, `closed: false`; локально с COOP `same-origin` открывающая страница видит `closed: true`, вкладка остаётся.
- `apps/web/public/_headers`: `Cross-Origin-Opener-Policy: same-origin`; `apps/worker/src/security-headers.ts`: то же значение явно. Сайт не вызывает `window.open` и не читает `window.opener`; расширения Wallet Standard COOP не затрагивает.
- Тесты: `apps/worker/test/security-headers.test.ts` ждёт пять заголовков и падал до правки; `apps/worker/test/fakes.ts` проверяет COOP на каждом маршруте API; Playwright `smoke.spec.ts` берёт заголовки из `_headers` сам.
- curl 06.10.2026 02:49 UTC: на `/app` dev и prod COOP пока нет — исправление не развёрнуто.

## Открытые пробелы

| | Пробел | Тяжесть | Что сделать | Почему остаётся |
|---|---|---|---|---|
| П4 | Дробление через Split: Split нужен только staker, каждая часть наследует замок (gate 8a). Вор дробит 1000 SOL на ~1000 частей по 1 SOL, после остывания — на пыль по 0,00167 SOL. Спасение — до 10 аккаунтов за прогон (`MAX_RESCUE_ACCOUNTS`), на nonce по одной транзакции, 3 подписи на аккаунт; пакетного продления нет. Что не успели до T, вор выводит. На пыли поиск по A упирается в CPU воркера | средний | Честно написать в FAQ и «What Stakeward cannot do»; «Extend all» на /app (до 10 SetLockup одним запросом ко второму ключу по блокхэшу); отдельная тревога на массовый Split | Пакетное спасение по блокхэшу меняет F4.3 («спасение всегда через nonce») — решение владельца (В9) |
| П5 | Два ключа из одного кошелька: `sameWallet` (`ProtectWizard.tsx:105-108`) показан как Alert `info` о переключении аккаунтов; FAQ сам пишет, что аккаунты одного кошелька обычно из одной seed-фразы. На /rescue такой проверки нет — в панике D добавляют «Add account» в том же Phantom | средний | При `sameWallet` — tone warning: «Accounts of one wallet app, and every account of one Ledger, usually come from one seed phrase. Continue only if you imported this account from a different seed phrase»; то же для слота New wallet на /rescue | Не входил в три подтверждённых пробела этого прохода; правка текста и одного условия |
| П6 | Смену staker вором /app подаёт как «A staking service may manage this stake… Check with the service before you protect it» (`account-row.tsx:120`) рядом с зелёным Protected, без ссылки на спасение | низкий | На строках protected и expiring при staker ≠ withdrawer: «Another key can stop or move this stake. If you did not set this up, your main key may be stolen» и ссылка на /rescue | То же |
| П7 | Непроверяемый Authorize(Withdrawer → X) в сети не проверен: gate и `thief.ts` пробуют только AuthorizeChecked, а FAQ (`faq.items.thefts.a`) обещает отказ и для него — это вектор SwissBorg | низкий | Два кейса на LiteSVM в `core/test/errors.svm.test.ts`: подпись одного A → CustodianMissing; A и чужой ключ в слоте хранителя → LockupInForce | То же |
| П8 | Нет совета держать второй ключ только для Stakeward. Фишинговый dApp получает подпись K на SetLockup(custodian = X), дальше вору хватает A | низкий | На SecondKeyStep и в FAQ good-second-key: «Use your second key only to co-sign Stakeward transactions; do not connect it to other sites» | То же |
| П9 | «Второй ключ один не заберёт» не доказано тестом; тревога LOCKUP_CHANGED ведёт на /app, а не к действию | низкий | 2–3 кейса на LiteSVM: K один не выводит и не меняет withdrawer; K меняет хранителя на X, и вывод A+K после этого падает. Если дату сдвинул K при прежнем хранителе — тревога «remove the lock with your second key now, then protect again» со ссылкой на `/extend/<account>?remove` | То же |
| П10 | `/start`: общий суточный лимит 1000 записей на все чаты, счётчик растёт до записи, даже на повторной привязке (`webhook.ts:43, 176-179`). Один аккаунт Telegram за ~50 минут закрывает привязку всем до конца суток | низкий | Считать только вставленные строки; добавить суточный предел на чат | То же |
| П11 | Экран «Готово» пишет «Monitoring is on», но без Telegram напоминаний не будет; RiskNote `lock-ends` используется только на /dev/ui | низкий | На «Готово» показать `lock-ends` с T и «Without Telegram alerts nobody reminds you before {date}»; по желанию .ics через blob | То же |
| П12 | Часы кластера для T приходят через /api/rpc (`PeriodStep.tsx:38`), сверки с часами устройства нет; инспектор ограничивает T только 01.01.2100. Лгущий воркер или Helius отдаёт Clock из 2099 года — мастер предложит замок до 2099 | низкий | Отказ при расхождении с часами устройства больше суток или потолок T = now устройства + 13 месяцев на mainnet (protect и extend) | То же |
| П13 | Прокси пропускает withdraw на любого получателя (`inspect.ts:564, 642`), хотя продукт выводит только на основной ключ (D64) | низкий | Отклонять в прокси withdraw с recipient ≠ withdrawer аккаунта. Защита в глубину: подписанные байты можно унести навигацией, спасение на D вора проходит по формату | То же |
| П14 | Защита по ссылке: `protect.second.linkHint` обещает «a wrong address simply cannot sign, and nothing changes». Мошенник («поддержка») просит вставить его адрес, подписывает, и настоящий /app показывает Protected (`ProtectWizard.tsx:139` запоминает хранителя) | низкий | Текст: «Paste only the address of a wallet you or a person you trust created. Stakeward never gives you a second key address; whoever holds it can freeze this stake» | То же |
| П15 | Механизм подписи не проверяет, что кошелёк добавил свою подпись: `checkSigningStep` пропускает неизменённые байты, шаг помечается signed. Остановит только финальный `verifyAllSignatures`; в режиме ссылки /cosign попросят ключ, который должен был подписать здесь. Денег не теряем, теряем одобрение и правду в списке подписантов | низкий | В `signStep` после повторного чтения требовать `step.address` в `presentSignatures` каждой транзакции, иначе `verify`/`missing-signatures`; тесты на пропуск подписи не на последнем шаге и в раунде по ссылке | То же |
| П16 | F5: если у второго ключа нет SOL, `extend/plan.ts:88` молча делает плательщиком основной ключ, не читая его баланс; ошибка просит «Add a little SOL to it». Если основной ключ украден и выметен ботом, пользователь пополнит вора (FAQ советует обратное) | низкий | В `extendPlan` переходить на основной ключ, только если `canPayFee` по его балансу, иначе ошибка называет Second key; при оплате основным — строка «If your main key may be stolen, send SOL to the second key instead»; тест K=0, A=0 | То же |
| П17 | Перехват вебхука украденным токеном бота: `setWebhook` на чужой сервер, ответы фишинговыми «Open Rescue», наш воркер не замечает (`sendMessage` работает). Плана ротации токена нет | средний | В суточной части прохода `getWebhookInfo` и `getMe`, сравнение с `SITE_ORIGIN + '/api/telegram/webhook'`, тревога в ADMIN_CHAT_ID (1–2 подзапроса в сутки). Записать процедуру: BotFather /revoke → `wrangler secret put TELEGRAM_BOT_TOKEN` → `setWebhook` с новым `secret_token` → сообщение в README | Код шага 5; в этот проход не входил |
| П18 | Целостность деплоя: `deploy:prod` собирает из локальной рабочей копии; нет проверки чистого дерева, совпадения HEAD с коммитом с зелёным CI, frozen install; guard-тесты идут на сборке CI, а не на выгружаемой; хеши ассетов не публикуются | средний | Обёртка деплоя (чистое дерево, HEAD == origin, frozen install, build-output и test-code-guard на dist, запись version id, коммита и sha256 ассетов в docs) и `scripts/verify-deploy.ts`: скачать index.html и `/assets/*` с домена и сравнить с локальной сборкой коммита | Новый скрипт; ведущему до деплоя prod |
| П19 | Секреты деплоя видны зависимостям сборки: по DECISIONS «Развёртывание» перед `pnpm deploy:*` экспортируется весь `~/.config/stakeward/secrets.env` (CLOUDFLARE_API_TOKEN, HELIUS_API_KEY, оба токена ботов), а `deploy:*` сначала запускает `vite build` — код vite, rollup, tailwind, lightningcss и их зависимостей | средний | Собирать без секретов, токен Cloudflare давать только процессу `wrangler deploy`; токены ботов и Helius убрать из экспортируемого файла (они уже в секретах Cloudflare) | Процедура и хранение токенов — владелец (В3) и ведущий |
| П20 | `minimumReleaseAge` нестрогий: встроенный суточный порог pnpm 12.8.1 молча дописывает свежие версии в `minimumReleaseAgeExclude` (CHANGELOG pnpm 12.8.1, D11). Так прошли vite 8.3.2 и wrangler 4.146.0 — цепочка сборки и деплоя | средний | Явно `minimumReleaseAge: 1440` (или 4320) в pnpm-workspace.yaml — тогда включается strict; `trustPolicy: no-downgrade`; почистить старые исключения отдельным коммитом с причиной | Меняет установку зависимостей; отдельный коммит с проверкой frozen install |
| П21 | `pnpm audit` только на push и pull_request, расписания нет; Dependabot не включён | низкий | `schedule` в CI раз в сутки (install и audit) или Dependabot alerts (В4) | То же |
| П22 | Лимит частоты /api/rpc: `RPC_RATE_LIMIT` 30 за 10 с на IP, но привязка Cloudflare согласована по локациям; с одного IP прошло 338 из 339 запросов за 15 с (~22 rps, в 7 раз больше настройки). Скрипт выжигает 10 rps и 1 млн кредитов Helius за полдня, gPA по 10 кредитов без кэша на workers.dev (D39). Монитор ходит в тот же Helius — тревоги встанут у всех | средний | Отдельный ключ RPC для монитора (В8); общий лимит на втором binding ниже rps Helius; лимиты на IP с поправкой на наблюдаемую слабость; кэш gPA на своём домене; нагрузочный тест на появление 429 | Отдельный ключ — владелец; остальное — код |
| П23 | Логи Cloudflare: `observability.logs` persist и `invocation_logs` включены, `redact_query_string` false. URL запросов с query (`/api/stake-accounts?withdrawer=`, `/api/accounts?wallet=`, `/api/telegram/link?wallet=`) хранятся рядом с IP и страной — это больше, чем «публичные данные и chat id» (§2.7, §8) | низкий | `"observability": { "enabled": true, "redact_query_string": true }` (ключ есть в `wrangler/config-schema.json`), по желанию `invocation_logs: false`; комментарий «трассировки не включать: в URL подзапросов ключ Helius и токен бота» | То же |
| П24 | Домен: описание prod-бота уже называет prod-адрес, README — нет (D84 «адрес prod не публикуем») | низкий | Решить, называть ли prod до шага 9; перед пользователями вписать домен в начало README, в раздел безопасности и развёртывания; повторить при переезде на свой домен | Решение владельца (В2) |
| П25 | Суточные пары повторного поиска (`DAILY_PAIRS`) идут в конец очереди, а `uniquePairs` режет её до 1000. Больше 1000 чужих пар с «ранними» адресами вытесняют суточный поиск по остальным. Срочный поиск после DEACTIVATED, STAKER_CHANGED, BALANCE_DECREASED идёт первым и не страдает | низкий | Листать пары курсором, как напоминания в П1 | Найдено при исправлении П1; суточный поиск — запасной путь |
| П26 | Перечитывание «правда в сети» идёт через тот же /api/rpc: лгущий воркер покажет ложный Protected или Done, спрячет аккаунт после Split из спасения, подсунет валидатора для повторного делегирования. Независимая проверка — эксплорер и CLI с карточки | нет | Одна строка в FAQ: как проверить состояние по эксплореру | Ограничение архитектуры (браузер видит сеть только через свой домен, §3) |

Ещё одно следствие П1: 1000 напоминаний такой атаки за сутки занимают окно ожидающих событий (100 за проход) и задерживают чужие тревоги примерно на 10 проходов, около 20 минут. Привязанного чата у этих событий нет, они закрываются без отправки.

## За владельцем

- **В1. Мониторинг на mainnet.** Workers Paid за 5 долларов: пустой проход cron — 7–8 мс CPU из 10, проход с 20 декодированиями — 10–15 мс, на free лимит снижен до 8 декодирований (D63). Пройти TESTPLAN «Шаг 5» в): настоящая тревога после Deactivate, LOCKUP_CHANGED после продления. После деплоя новой сборки в prod проверить `/api/health` (06.10.2026 02:49 UTC старая сборка prod отвечает 200, последний проход 02:48:32 UTC).
- **В2. Домен.** Купить короткий домен (§3 требует его с первого дня), вписать в README и описания ботов, пройти форму Phantom. В зоне включить Always Use HTTPS (потом HSTS preload) и выключить Network Error Logging. До этого решить П24.
- **В3. Доступы.** 2FA на Cloudflare, GitHub и аккаунте Telegram, который владеет ботами. Токен Cloudflare с минимальными правами и сроком жизни, отзывать после деплоя, не держать на VPS, где агенты запускают код из npm. Защита ветки main и запрет force-push.
- **В4. Dependabot alerts** в настройках GitHub (или расписание из П21).
- **В5. Preview-адреса prod.** У `stakeward-prod` `previews_enabled: true`: `https://037f86ff-stakeward-prod.zhibul-alexander.workers.dev/` отдаёт приложение с базой и секретами prod. В конфиге уже `preview_urls: false`, вступит со следующим деплоем prod; сразу — выключить в панели или `PATCH subdomain previews_enabled:false`. После деплоя проверить, что старый адрес не открывается. У dev выключено, старые версии отвечают 404 (error code 1042).
- **В6. Боты в группах.** `can_join_groups: true` у обоих: в группе любой участник может сделать `/stop`, а список кошельков виден группе. BotFather `/setjoingroups` → Disable (или вебхук отклоняет не-личные чаты).
- **В7. Слить build/product в main** до публикации prod: ссылки сайта на README («Recover without Stakeward») и docs/gate.md ведут на main, а там код шага 3.
- **В8. Второй ключ Helius** (или платный план) только для монитора, чтобы прокси не мог выжечь кредиты тревог (П22).
- **В9. Решение по F4.3**: разрешить спасение пачкой по блокхэшу, когда A, D и K подключены в одном браузере (П4).

## Чем проверено 06.10.2026

Этот проход:
- `apps/worker`: `pnpm exec vitest run test/monitor/reminders.test.ts test/monitor/store.test.ts test/security-headers.test.ts` — 3 файла, 46 из 46.
- `apps/web`: `pnpm exec vitest run test/landing.test.tsx` — 18 из 18.
- `pnpm audit` — No known vulnerabilities found.
- curl 02:49 UTC: `/app` на dev и prod — CSP из §11 на месте, COOP нет (П3 не развёрнут); `/api/health` на dev и prod — 200.
- `git log -- pnpm-lock.yaml`: 6 коммитов, все добавляют зависимости, версии не поднимались.

Исправления П1–П3 (отчёт исполнителя): `pnpm typecheck`, `pnpm lint` без ошибок; worker 558 из 558 (было 553); web 747 из 747 (было 746); `wrangler types --check` актуально; `pnpm e2e` 18 из 18; `pnpm e2e:mainnet` 2 из 2. Core и scripts не менялись.

Аудит до исправлений: core lockup, status, diff, inspect, watch — 230 из 230; worker reminders и store — 88 из 88; web signing, cosign, rescue, link — 81 из 81; build-output и test-code-guard — 12 из 12. Живые пробы dev и prod: заголовки на всех маршрутах и ассетах, /api/rpc (методы вне списка → -32601, неверные параметры → -32602, 415, 413, отказ инспектора на чужих транзакциях), лимит частоты, вебхук 401. Через API Cloudflare и Telegram читались настройки воркеров, привязки секретов, `getWebhookInfo`, `getMe`, описания ботов. getAccountInfo программы Lighthouse в mainnet.

## Для ведущего

- Закоммитить П1–П3 и выкатить `pnpm deploy:dev` (миграций нет), затем проверить COOP на `/app` и проход мониторинга в `wrangler tail` — CPU прохода с полной страницей напоминаний.
- Записать в DECISIONS: расхождение с §2.6 (взломанный деплой — это взломанный сайт, П2); поправку к D10 (COOP теперь и на страницах); поправку к D58 (напоминания страницами по курсору `meta.daily_sweep`, `reminderPageRows`); закрытие вопроса D24 (Lighthouse неизменяемая, authority null).
- Исправить docs/SUBMISSION.md:109 («down or hacked»).
- Пункты В1–В9 перенести в docs/TESTPLAN.md, чтобы владелец прошёл их перед подачей.
- Мелочь в docs: D31 называет `signAndSend*`, а guard проверяет имена фич с префиксом `solana:`; в бандле есть мёртвая проверка типа `signAndSendTransactions` из kit, вызова фичи кошелька нет.
