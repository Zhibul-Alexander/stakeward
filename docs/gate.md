# Проверка механизма

Скрипт `scripts/gate.ts` (CLAUDE.md, шаг 1) проверяет на настоящей стейк-программе правила замка (lockup), на которых
держится Stakeward. Транзакции, которые отправляет и продукт, собирает `buildTransaction` из `packages/core`: формат
из §4 и старый порядок аккаунтов для Ledger (D1). Действия, которых в продукте нет (AuthorizeChecked вора, Split,
Merge), собраны в том же формате. Неудачные транзакции в devnet и mainnet отправляются без preflight, поэтому у них
тоже есть подпись в сети. Ключи: A — основной, B — второй (хранитель замка), X — staker вора, D — новый кошелёк.

- LiteSVM: `pnpm gate:litesvm`. Тот же прогон идёт в CI как тест `scripts/gate/gate.test.ts`.
- Devnet: `pnpm gate:devnet`. Платит ключ-спонсор `.keys/devnet-funder.json`, ключи ролей прогона лежат в `.keys/gate-devnet-<роль>.json`, в конце всё, кроме комиссий, возвращается спонсору.
- Mainnet: `pnpm gate:mainnet`. Одноразовый ключ `.keys/mainnet-gate.json`, неделегированный аккаунт, проверки 2, 3, 4, 5, 6 и 13, в конце всё выводится обратно на этот ключ.

Адрес RPC задаёт переменная `RPC_URL`, по умолчанию — публичный узел кластера. Каждый прогон переписывает только
свой раздел этого файла.

<!-- gate:litesvm:begin -->
## LiteSVM

Прогон 2026-10-02 12:30:22 UTC: 24 из 24 шагов совпали с ожиданием.

- Стейк-программа: загружена в LiteSVM из фикстуры; programdata `6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`, слот развёртывания 447552000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
- Часы кластера в начале: 2026-10-01 00:00:00 UTC, эпоха 1000.
- Ключи: A `4di5mPweJ4aCrPgQzNBX79hu94r7HRLWf7rgoi3UyTxP`, B `9tqoyYBtbkCchHq4AyQJFD4r4tBSYCLFk8aM7QUsPb14`, X `4dZLYQ6hosuBSiXMGEmhPWf3aXvQE3FNeXiDzYUiB7JZ`, D `Ci7j9ARdgsf5urFhmayM23c7LAfBZidGtt2wMyesgMy`. Спонсор `Bj4dEuVP4ivazEqJUZXnGrMu2oPSy7wuWBbpfzF4sQz4`.
- Делегация на vote-аккаунт `2mL64qC2BuhyWWqEFZSgqB7XDY4YAVciNFik9smGViaa`.
- Транзакций: 33, комиссии сети: 284 800 лампортов (0,0002848 SOL). На старте у плательщика было ровно 1,0122736 SOL.
- Возврат средств завершён, ключи ролей пусты:
  - Sm `5uhuU5ts2hg4jzva3EEU52WrEkbw4hcmpP1rYAdkkFrA`: Withdraw 0,00166624 SOL плательщику: ok
  - S1 `2QLxPxB6ndeMFdZtfeGMQxmyV8ce9Y3fWDFTTwCSh3Pq`: Withdraw 0,50166624 SOL плательщику: ok
  - S3 `CS66NFGPsoUFjVBfSr7eCdHzJ85uoPZB4whLh4gym3Th`: Withdraw 0,00166624 SOL плательщику: ok
  - остатки ключей ролей (0,50633984 SOL) переведены плательщику: ok

| № | Проверка | Ожидание | Результат | Подпись или код ошибки |
|---|---|---|---|---|
| 1a | Создать стейк-аккаунт S1: staker = withdrawer = A, без замка, 1 SOL сверх залога | успех | совпало: успех; 1,00166624 SOL, staker A, withdrawer A, без замка | `4s1H…AfNM` |
| 1b | Делегировать S1: DelegateStake с подписью A | успех | совпало: успех; делегирован 2mL64qC2BuhyWWqEFZSgqB7XDY4YAVciNFik9smGViaa в эпохе 1000 | `5MrW…u57v` |
| 2 | Главное утверждение. SetLockupChecked на S1 с подписями A и B: unix_timestamp = сейчас + 1 час, хранитель B | успех | совпало: успех; unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | `Quqx…GSL4` |
| 3 | Withdraw всего S1 с подписью только A | ошибка LockupInForce | совпало: ошибка; баланс S1 не изменился | LockupInForce (код 1), инструкция 3 · `4SGd…VbpQ` |
| 4 | AuthorizeChecked(Withdrawer -> X) с подписями A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · `3jGM…6t2K` |
| 5 | SetLockup (unix_timestamp = 0) с подписью A при действующем замке | ошибка MissingRequiredSignature | совпало: ошибка; unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | MissingRequiredSignature, инструкция 3 · `cj7k…HKQr` |
| 6 | SetLockup с подписью B: продление до сейчас + 2 часа | успех | совпало: успех; unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `DTAV…QUZA` |
| 7a | Вор с ключом A: Deactivate S1 с подписью A | успех | совпало: успех; deactivation_epoch = 1000 | `4saq…1dKe` |
| 7b | Вор с ключом A: AuthorizeChecked(Staker -> X) с подписями A и X | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `2w7o…XCqQ` |
| 8a | Split S1 в S2 (подпись staker X): у S2 тот же замок | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `4A5m…k58F` |
| 8b | Withdraw всего S2 с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · `NfeL…PPrX` |
| 9 | Merge незапертого Sm (staker X, withdrawer A, как у S1) в запертый S1 | ошибка MergeMismatch | совпало: ошибка; Sm на месте | MergeMismatch (код 6), инструкция 3 · `3iXM…9NiP` |
| 10 | Withdraw 0,25 SOL из запертого неделегированного S2 с подписями A и B | успех | совпало: успех; на S2 осталось 0,25166624 SOL | `4cP5…n61z` |
| 11a | Спасение S1 после шага 7, одна транзакция, комиссию платит D: AuthorizeChecked(Staker -> D) с подписями A и D и AuthorizeChecked(Withdrawer -> D) с подписями A, D и B | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `25pu…GzqR` |
| 11b | После спасения: Withdraw из S1 с подписями A и B | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · `4RkB…XE3i` |
| 11c | После спасения: AuthorizeChecked(Staker -> X) на S1 с подписями A и X | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · `3DvX…FUs5` |
| 12a | D создаёт nonce-аккаунт (CreateAccountWithSeed + InitializeNonceAccount, authority D) | успех | совпало: успех; nonce-аккаунт 3j5NBE5PEJSHgADYhvFM5SZeUWod8P7LHvFPM2K7N3M2, authority D | `4FdH…E3bi` |
| 12b | То же спасение запертого S3 на durable nonce D: подписи D, A, B добавляются по одной, между ними транзакция уходит в ссылку /cosign#tx= и разбирается обратно | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B; nonce сдвинут: да; ссылка /cosign 818 символов | `2PBf…TaQ9` |
| 12c | D закрывает nonce-аккаунт и забирает залог | успех | совпало: успех; аккаунт закрыт, всё выведено | `2t4y…7UDS` |
| 13a | B ставит unix_timestamp = 0 на запертом S2 | успех | совпало: успех; unix_timestamp = 0, хранитель B | `2bvk…aJVW` |
| 13b | Withdraw всего S2 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | `21sj…Qc3U` |
| 14a | S4 заперт B до T: Withdraw с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · `RXda…R6qf` |
| 14b | Часы переведены за T: SetLockup (unix_timestamp = 0) с подписью только A | успех | совпало: успех; unix_timestamp = 0, хранитель B | `2jFR…PUgp` |
| 14c | Withdraw всего S4 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | `KBiD…y1Lu` |
<!-- gate:litesvm:end -->

<!-- gate:devnet:begin -->
## Devnet

**Ожидает пополнения.** Адрес [`D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL`](https://explorer.solana.com/address/D8LAb6uPB8bBiPWbbb53nr15qd9CLvNX4qHoJr1yySTL?cluster=devnet) (`.keys/devnet-funder.json`), баланс сейчас 0 SOL. Нужно не меньше **1,01058496 SOL** (1 010 584 960 лампортов):

- S1: залог за аренду + 1 SOL, минимум делегации: 1 001 666 240
- S2 (цель Split), Sm (для Merge), S3 (спасение на nonce): залоги за аренду: 4 998 720
- ключ A: остаток + комиссии: 768 640
- ключ B: остаток + комиссии: 661 440
- ключ D: остаток + залог nonce-аккаунта + комиссии: 1 749 280
- комиссии спонсора: подготовка и возврат средств: 90 400
- остаток спонсора: 650 240

Не вернутся только комиссии сети: 0,0002624 SOL. Пополнить: https://faucet.solana.com (devnet) или переводом с devnet-кошелька, затем `pnpm gate:devnet`.

- Стейк-программа: programdata [`6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`](https://explorer.solana.com/address/6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ?cluster=devnet), слот развёртывания 488592000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
<!-- gate:devnet:end -->

<!-- gate:mainnet:begin -->
## Mainnet

**Ожидает пополнения.** Адрес [`7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v`](https://explorer.solana.com/address/7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v) (`.keys/mainnet-gate.json`), баланс сейчас 0 SOL. Нужно не меньше **0,00238128 SOL** (2 381 280 лампортов):

- S1, неделегированный стейк-аккаунт (залог за аренду, вернётся): 1 666 240
- комиссии 8 транзакций: 64 800
- остаток, без которого ключ не может платить комиссии (вернётся): 650 240

Не вернутся только комиссии сети: 0,0000648 SOL. Удобно перевести 0,02 SOL, затем `pnpm gate:mainnet`. Остаток потом выводится одной командой: `solana transfer --from .keys/mainnet-gate.json <ваш адрес> ALL --url mainnet-beta`.

- Стейк-программа: programdata [`6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`](https://explorer.solana.com/address/6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ), слот развёртывания 443232000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
<!-- gate:mainnet:end -->
