# Видео для подачи

Два видео, оба на английском. Требования Colosseum (форма «Media and code», 11.10.2026):

| Видео | Длина | Что Colosseum просит | Куда идёт |
|---|---|---|---|
| Pitch video | до 2:00 | «Introduce yourselves, tell us what you're building, and why you're the people to build it. Nothing fancy required. We're interested in how you think and communicate.» | Colosseum «Pitch video»; Superteam Earn «Link to your pitch deck or Loom/video presentation» |
| Demo video | до 3:00 | «Should show the live product, not a slide deck, not a code walkthrough.» | Colosseum «Please submit a demo video of your product» |

Ссылки: YouTube (доступ «по ссылке», Unlisted), Loom или Vimeo. Перед отправкой открыть ссылку в окне инкогнито: видео должно играть без входа.

Чем писать: Loom (экран и камера, ссылка сразу) или QuickTime (Файл → Новая видеозапись / Новая запись экрана) и загрузка на YouTube. Микрофон ближе ко рту, тихая комната. Монтаж — любой: обрезать паузы, ускорить ожидания, вырезать экраны блокировки Phantom кроме одного.

Факты в тексте сверены с кодом и docs на 11.10.2026: SUBMISSION §11 (источники SwissBorg и Step Finance), docs/gate.md (mainnet), PROGRESS (проход на mainnet 10–11.10). Ничего сверх этого в кадре не обещать.

---

## 1. Pitch video — 2:00, вы в кадре

Камера на уровне глаз, свет спереди, фон спокойный. Английский уровня B1: короткие предложения, простые слова, у каждой фразы один смысл. Говорите спокойно, не быстро: около 260 слов — это 2:00 (без двух TODO; ваши фразы держите короткими). Текст можно учить кусками по блокам; читать с листа не нужно. Слайды не нужны.

**0:00–0:12. Кто вы**

> Hi, my name is `<name>`. I am a developer from Tbilisi, Georgia. `[TODO: one simple sentence about you.]` I built Stakeward.

**0:12–0:40. Проблема**

> One key controls your staked SOL: the key of your wallet. If someone steals this key, they can take all of your staked SOL. Keys get stolen through fake websites, viruses, or a bad transaction that you sign by mistake. This really happens. In 2025, SwissBorg lost about 192,600 staked SOL. In 2026, Step Finance lost 261,854 staked SOL.

**0:40–1:05. Решение**

> Solana already has a lock for staked SOL. When the lock is on, a second key must also sign before anyone can take the SOL out. The documentation says you can turn it on only when you create a stake. I tested it on mainnet: you can turn it on later too. Stakeward turns on this lock for your stake. The second key is another wallet that you own.

**1:05–1:25. Что уже работает**

> Stakeward works on mainnet today. I protected my own stake. Then I acted as a thief with my main key. I could stop the staking, but Solana did not let me take the SOL out. I got a message in Telegram, and I moved my stake to a new wallet. Stakeward never holds your SOL or your keys.

**1:25–1:45. Для кого и деньги**

> Stakeward is for people with a lot of staked SOL, for validators and for teams. For one person, it is free. Teams and validators will pay for extra features, like alerts in their own chats and reports.

**1:45–2:00. Почему вы**

> `[TODO: why you, one or two simple sentences.]` The code is open, and before you sign, Stakeward shows exactly what the transaction does. Stakeward: a lock for your staked SOL, and Solana itself checks it.

Проверка перед записью: 192 600 и 261 854 SOL и годы — из SUBMISSION §11. «I tested it on mainnet» — docs/gate.md. «I could stop the staking … did not let me take the SOL out … message in Telegram … moved my stake» — проход владельца на mainnet 10–11.10.2026 (PROGRESS). Строку про деньги держать как в BUSINESS-MODEL.md, без цен.

---

## 2. Demo video — до 3:00, экран и голос

История: защита → кража ключа → сеть отказывает вору → тревога → спасение. Пишем на **devnet** (`https://stakeward-dev.stakeward.workers.dev`): не тратим настоящие SOL, сроки по 10 минут и 1 часу, и вор работает через Solana CLI с одноразовым ключом. Одной фразой говорим, что то же самое прошло на mainnet.

### Подготовка (один раз, около 30 минут)

1. Три **новых** аккаунта Phantom только для демо, каждый из своей новой фразы: **Demo Main**, **Demo Second**, **Demo New**. Фраза Demo Main будет введена в терминал «вора», поэтому Acc 1–3 для демо брать нельзя.
2. Phantom: Settings → Developer Settings → Testnet Mode → Solana Devnet.
3. Devnet SOL: Demo Main 0,05, Demo New 0,02. Demo Second не нужен. Пришлите Claude адрес Demo Main — он запустит `pnpm dev-accounts <адрес>`: появятся делегированный (1 SOL) и неделегированный (0,1 SOL) стейк-аккаунты без замка. Делегированный ниже — `<STAKE>`.
4. Терминал вора (Solana CLI 4.3.0: `sh -c "$(curl -sSfL https://release.anza.xyz/v4.3.0/install)"`):
   - `solana-keygen recover 'prompt://?key=0/0' --outfile stolen-main.json` — ввести фразу Demo Main; `solana-keygen pubkey stolen-main.json` должен напечатать адрес Demo Main;
   - `solana-keygen new --no-bip39-passphrase --outfile thief.json` и перевести на него 0,05 devnet SOL.
5. Telegram: в `@stakeward_dev_bot` отправить `/start <адрес Demo Main>`; Telegram Desktop открыт на этом же компьютере.
6. Браузер: ширина 1280, светлая тема, масштаб 110 %, лишние вкладки закрыты.
7. Один полный прогон-репетиция. Если строка CLI отличается от ожидаемой ниже, в кадре вместо неё — упавшая транзакция в Solana Explorer (такие же есть в docs/gate.md).

### Сценарий

| Время | На экране | Голос |
|---|---|---|
| 0:00–0:10 | Лендинг dev с пометкой Devnet. | This is Stakeward on devnet. I ran the same steps on mainnet with real SOL; here I'm about to have my main key stolen. |
| 0:10–0:22 | В «Check your stake» вставить адрес Demo Main. `/app`: два аккаунта, оба **Not protected**, сверху «Last checked … ago». | First I just look. No wallet, nothing to sign: two stake accounts, both unprotected. |
| 0:22–0:40 | **Protect** → Accounts: подключить Demo Main, оба отмечены → Second key: переключить Phantom на Demo Second, подключить; предупреждение про один кошелёк; галочка «My second key comes from a different seed phrase». | I connect my main key, then my second key. It lives in the same app here, but it comes from its own seed phrase, and the page makes me confirm exactly that. |
| 0:40–0:50 | **Lock period**: показать карточки и **Custom date**, выбрать «1 hour (devnet test)». Предупреждение с датой. | I pick how long the lock holds, a fixed period or any date. The risk is said before I sign: lose the second key, and you wait until this date. |
| 0:50–1:05 | **Review and sign**: аккаунты целиком, кто подписывает, комиссия, «This transaction cannot move your SOL», «Stakeward never asks for your seed phrase». Подписать Demo Main, переключить Phantom, подписать Demo Second. Если Phantom блокирует — один экран блокировки оставить в кадре. | The summary is read from the exact bytes my wallet signs. Phantom flags it, because any change of keys on a stake account looks risky to it; every address here is mine. |
| 1:05–1:15 | «2 stake accounts are protected», дата, Telegram, карточка восстановления. | Protected, and checked on the network. |
| 1:15–1:25 | Терминал, подпись «The thief has my main key». `solana deactivate-stake <STAKE> --stake-authority stolen-main.json --fee-payer thief.json --url devnet` — успех. | Now a thief has my main key. They can stop my staking. That works. |
| 1:25–1:35 | `solana withdraw-stake <STAKE> <АДРЕС thief.json> ALL --withdraw-authority stolen-main.json --fee-payer thief.json --url devnet` → `Error: lockup has not yet expired`. | But withdraw? The Solana network refuses. The lock needs my second key. |
| 1:35–1:45 | `solana stake-authorize-checked <STAKE> --withdraw-authority stolen-main.json --new-withdraw-authority thief.json --fee-payer thief.json --url devnet` → ошибка про custodian. | And handing the stake to themselves, the trick from the SwissBorg case, is refused too. |
| 1:45–1:55 | Склейка «2 minutes later». Telegram: «Stake … was deactivated. If this was not you, your main key may be stolen. Your SOL cannot be withdrawn without the second key.» и кнопка **Open Rescue**. | Two minutes later, my phone tells me. |
| 1:55–2:05 | Нажать **Open Rescue**: `/rescue` с адресом Demo Main → «Find its stake». | One tap opens the rescue with my main key filled in. |
| 2:05–2:20 | **New wallet**: подключить Demo New, галочка про новую фразу, проверка баланса. **Keys**: Main key и Second key — **This browser**. | I connect a new wallet from a new seed phrase. It pays the fees, so the stolen key never pays anything. |
| 2:20–2:35 | **Move**: «New owner of your stake» целиком. Подписи: Demo New, Demo Main, Demo Second — каждый кошелёк подписывает оба аккаунта одним запросом. Ускорить ×4, экраны Phantom вырезать. | Three keys sign: my old main key, which I still have, my second key, and the new wallet. Each wallet approves once for all accounts. |
| 2:35–2:45 | Done: «2 stake accounts are safe», новый владелец. | My stake now belongs to the new wallet, still locked. The thief's key controls nothing. |
| 2:45–2:58 | Solana Explorer (Devnet) у одного аккаунта: Stake и Withdraw Authority = Demo New, Lockup Custodian = Demo Second. Финальная карточка: логотип, адрес репозитория, «Free. Non-custodial. No program, no token.» | Verified on chain. Stakeward: free, open source, and it never touches your SOL. |

Если в 3:00 не влезает — режьте 0:40–0:50 до 5 секунд и 1:35–1:45 целиком. Если вор в CLI не готов — вместо 1:15–1:45 «More → Try to steal it» на `/app`: обе строки «Blocked by the lock» (без подписей и без ключа вора).

### Что не показывать

- Подпись по ссылке на mainnet с Phantom первым — не работает (D121).
- Обещания цен, пользователей и цифр, которых нет на `/stats`.
- Адреса и фразы Acc 1–3 и любых кошельков с настоящими SOL.

---

## Порядок работы

1. Владелец: создать три демо-аккаунта и прислать адрес Demo Main → Claude готовит стейк на devnet.
2. Репетиция демо, затем запись демо.
3. Запись питча (2–3 дубля, взять лучший).
4. Загрузить оба видео, проверить ссылки в инкогнито.
5. Colosseum: Demo video, Pitch video, Live product link → Final submission. Superteam Earn: ссылка на питч → Submit.
