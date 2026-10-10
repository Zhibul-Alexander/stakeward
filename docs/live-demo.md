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

## Терминалы на сцене

В каждом окне: `source scripts/live-demo/role.sh <роль>`. Роль видна в приглашении и заголовке окна цветом:
`owner` (зелёный), `thief` (красный), `second` (фиолетовый), `new` (голубой). Команда везде одна, `sw`;
в окне вора есть ещё `thief`.

## Сценарий (около 3 минут)

| Окно | Команда | Что видит зал |
|---|---|---|
| owner | `sw status` | 🔓 NOT LOCKED: whoever has the main key can take it |
| thief | `thief withdraw` | без замка: ⚠ ACCEPTED, вор забрал всё (показывать на отдельном стейке, если нужно «до») |
| owner | `sw stake 0.1` и `sw lock 6mo` | ✅ ACCEPTED, замок до даты, второй ключ держит замок |
| owner | `sw status` | 🔒 PROTECTED until …, second key: SECOND KEY |
| thief | `thief withdraw` | ⛔ REJECTED by Solana: Locked until …: the second key must co-sign |
| thief | `thief take` | ⛔ REJECTED by Solana: changing the owner needs the second key |
| thief | `thief unlock` | ⛔ REJECTED: only the second key can change the lock while it is on |
| thief | `thief staker` или `thief unstake` | ✅ ACCEPTED: это вор может, SOL остаются на месте, приходит тревога |
| new | `sw rescue` | ✅ ACCEPTED: стейк теперь у NEW WALLET, замок прежний |
| thief | `thief withdraw` | ⛔ REJECTED by Solana: the main key no longer owns this stake |
| owner | `sw status` | owner (withdraw): NEW WALLET |

`thief all` — три отказа подряд. `thief unstake` и `thief staker` работают только на делегированном стейке и до
спасения. Тревога в Telegram придёт, если основной кошелёк привязан к dev-боту и аккаунт под наблюдением (защита
через сайт или `POST /api/watch`).

Отказы вора по умолчанию попадают в сеть как упавшие транзакции (`--skip-preflight`), и под ними есть ссылка на
эксплорер. Вор платит за это комиссию. `SW_ONCHAIN_FAILS=0` — только симуляция: быстрее, но без ссылки.
`thief unlock` отказывает до отправки: CLI сам читает аккаунт и видит, что хранитель не main; скрипт так и пишет.

## Остальные команды

`sw help` — полный список: `transfer <от> <кому> <SOL>`, `unstake`, `withdraw` (main + second), `extend 1d`,
`unlock`, `withdraw-new` (после спасения), `balances`, `sweep` (вернуть остатки на `SW_FUNDER_KEY`).
Сроки: `10m`, `2h`, `3d`, `6mo` или дата `2027-04-11T00:00:00Z`. Другой стейк-аккаунт: `SW_STAKE=<адрес> sw status`.

## Чем проверено

Весь сценарий выше, плюс `fund`, `sweep`, `transfer`, `withdraw`, `extend`, `unlock`, `withdraw-new` — на `solana-test-validator` 4.3.0 (10.10.2026, Linux, bash 5). На devnet и в zsh на маке — прогон
владельца перед демо.
