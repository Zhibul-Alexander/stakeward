# Живое демо в терминалах

`scripts/live-demo/sw.sh` показывает механизм Stakeward на сцене обычным Solana CLI: каждое действие — одна команда
`solana`, скрипт печатает её (пути ключей заменены на `$main.json`, адреса подписаны ролями), выполняет и говорит
крупно: «✅ ACCEPTED by Solana» или «⛔ REJECTED by Solana: Locked until …: the second key must co-sign», плюс ссылка
на эксплорер. Сайт и воркер в этом не участвуют.

Ключи — одноразовые файлы демо-кошельков в `.keys/live-demo/` (папка в .gitignore): `main.json`, `second.json`,
`new.json`, `thief.json`, файлы стейк-аккаунтов и `demo.env`. Seed-фраз нет нигде. Только devnet (или localnet);
настоящий кошелёк сюда не класть.

## Подготовка (один раз, на маке)

```sh
cd ~/путь/к/stakeward
scripts/live-demo/sw.sh setup          # создаёт 4 ключа и .keys/live-demo/demo.env
```

В `.keys/live-demo/demo.env` вписать `SW_FUNDER_KEY` — путь к файлу ключа с devnet SOL (например, тот, которым
пополняли вора 10.10). Без него `sw fund` просит airdrop, а кран devnet часто отказывает. Solana CLI скрипт ищет в
PATH, затем в `~/.local/share/solana/install/active_release/bin`.

```sh
source scripts/live-demo/role.sh owner
sw fund 0.05                           # по 0.05 SOL каждому из четырёх
sw stake 0.1                           # стейк-аккаунт: владелец main, замка нет
sw status
```

Для делегированного стейка: `sw stake 1.1 && sw delegate` (на devnet делегировать можно от 1 SOL).

## Меню вместо команд

`sw menu` (или `sw menu 10m` — срок замка) показывает весь сценарий пронумерованными шагами с цветом роли и тем, что
увидит зал. Enter запускает следующий шаг, номер — любой шаг, `m` — список заново, `q` — выход. Каждый шаг — та же
команда `sw`.

Полный вывод сети меню пишет в `.keys/live-demo/network.log`, а `sw log` во втором терминале показывает его и
скроллится отдельно: всё, что ответил CLI, и сама транзакция из сети (`solana confirm -v`) — аккаунты, инструкция,
статус, балансы, логи стейк-программы. В окне меню остаются команда, вердикт и ссылка на эксплорер.
`SW_LOG_FILE= sw menu` — всё в одном окне. Отдельные команды `sw` печатают полный вывод сразу; `SW_NETLOG=0` —
коротко. Ключ API в адресе RPC на экран не попадает.

## Страница в браузере

`sw ui` открывает http://127.0.0.1:4848 — тот же сценарий для проектора. Вверху балансы четырёх кошельков и статус
текущего стейка (обновляются после каждого шага, изменившийся баланс подсвечивается). Ниже три колонки, каждая
скроллится отдельно: шаги (Enter — следующий), «что произошло» с крупным вердиктом и ссылкой на эксплорер, полный
вывод сети. Цвета и шрифт — как на сайте. Сервер слушает только 127.0.0.1 и запускает только шаги из `ui.ts`.

## Терминалы на сцене

В каждом окне: `source scripts/live-demo/role.sh <роль>`. Роль видна в приглашении и заголовке окна цветом:
`owner` (зелёный), `thief` (красный), `second` (фиолетовый), `new` (голубой). Команда везде одна, `sw`;
в окне вора есть ещё `thief`.

## Сценарий (около 3 минут)

| Окно | Команда | Что видит зал |
|---|---|---|
| owner | `sw status` | 🔓 NOT LOCKED: whoever has the main key can take it |
| thief | `thief withdraw` | без замка: 🚨 ACCEPTED, вор забрал весь стейк (небольшой, 0.1 SOL) |
| owner | `sw stake 1` и `sw lock 6mo` | ✅ ACCEPTED, замок до даты, второй ключ держит замок |
| owner | `sw status` | 🔒 PROTECTED until …, second key: SECOND KEY |
| thief | `thief wallet` | 🚨 ACCEPTED: вор забрал всё свободное с кошелька MAIN, баланс MAIN 0, а 1 SOL в стейке на месте |
| thief | `thief withdraw` | ⛔ REJECTED by Solana: Locked until …: the second key must co-sign (стейк вор не трогает) |
| thief | `thief take` | ⛔ REJECTED by Solana: changing the owner needs the second key |
| thief | `thief unlock` | ⛔ REJECTED: only the second key can change the lock while it is on |
| thief | `thief staker` или `thief unstake` | ✅ ACCEPTED: это вор может, SOL остаются на месте, приходит тревога |
| new | `sw rescue` | ✅ ACCEPTED: стейк теперь у NEW WALLET, замок прежний |
| thief | `thief withdraw` | ⛔ REJECTED by Solana: the main key no longer owns this stake |
| owner | `sw status` | owner (withdraw): NEW WALLET |

Пополнение для сценария: `sw fund 0.25 1.25` — MAIN получает 1.25 SOL (стейки 0.1 и 1 SOL), остальные по 0.25.
`thief all` — три отказа подряд. `thief unstake` и `thief staker` работают только на делегированном стейке и до
спасения. Тревога в Telegram придёт, если основной кошелёк привязан к dev-боту и аккаунт под наблюдением (защита
через сайт или `POST /api/watch`).

Отказы вора по умолчанию попадают в сеть как упавшие транзакции (`--skip-preflight`), и под ними есть ссылка на
эксплорер. Вор платит за это комиссию. `SW_ONCHAIN_FAILS=0` — только симуляция: быстрее, но без ссылки.
`thief unlock` отказывает до отправки: CLI сам читает аккаунт и видит, что хранитель не main; скрипт так и пишет.

## Если сеть не отвечает

Сначала пробовать без Helius, на публичном devnet: `SW_URL=devnet sw ui` (или `sw menu`). Лимит публичного
`api.devnet.solana.com` считается по IP, так что на другой машине или в другой сети 429 может и не быть. Перед каждой
командой скрипт за 8 секунд проверяет RPC (`getHealth`); если тот молчит или отвечает 429 («Connection rate limits
exceeded»), скрипт говорит об этом и не висит. Тогда — Helius: в `.keys/live-demo/demo.env` в строке `SW_URL`
указать `https://devnet.helius-rpc.com/?api-key=<ключ>`. Ссылки эксплорера при этом остаются на devnet.

## Выбор сети

Переключатель «Network» в шапке страницы или `sw net devnet | rpc | local` в терминале; выбор сохраняется в
`.keys/live-demo/network` и действует для всех терминалов и страницы. `devnet` — публичный, `rpc` — `SW_URL` из
`demo.env` (например, Helius), `local` — сеть на этом маке. `SW_URL`, заданный в самом терминале, важнее переключателя.

`local` сам поднимает `solana-test-validator` (идёт вместе с Solana CLI) в фоне, если тот не отвечает, и кладёт по
2 SOL на каждый демо-кошелёк: секунд десять, без интернета и без лимитов. Каждый такой запуск — сеть с нуля; у каждой
сети свой текущий стейк. Остановить: `sw localnet stop`. Ссылки эксплорера на локальной сети открываются только на
этом маке. Для зала честно так и называть: настоящая стейк-программа Solana, но локальная сеть.

## Остальные команды

`sw help` — полный список: `transfer <от> <кому> <SOL>`, `unstake`, `withdraw` (main + second), `extend 1d`,
`unlock`, `withdraw-new` (после спасения), `balances`, `sweep` (вернуть остатки на `SW_FUNDER_KEY`).
Сроки: `10m`, `2h`, `3d`, `6mo` или дата `2027-04-11T00:00:00Z`. Другой стейк-аккаунт: `SW_STAKE=<адрес> sw status`.

## Чем проверено

Весь сценарий выше, плюс `fund`, `sweep`, `transfer`, `withdraw`, `extend`, `unlock`, `withdraw-new` — на `solana-test-validator` 4.3.0 (10.10.2026, Linux, bash 5). На devnet и в zsh на маке — прогон
владельца перед демо.
