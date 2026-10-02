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

Прогон 2026-10-02 11:18:50 UTC: 24 из 24 шагов совпали с ожиданием.

- Стейк-программа: загружена в LiteSVM из фикстуры; programdata `6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`, слот развёртывания 447552000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
- Часы кластера в начале: 2026-10-01 00:00:00 UTC, эпоха 1000.
- Ключи: A `3uq79u3CPNro4cPTotBcygTjaZY1MtnGt5m8FjetD5We`, B `GDN32bpo7TrD6n3XP2s5hgkXe523Lfjpprr5CZ225zro`, X `J9yjVdjydFPEfZxkErqdqNzndXjMwUsnDSUzKSVo824n`, D `HcEwYZVFXvXYacB52ptQWg5pZABT5BUqfpoVJbuWNg5e`. Спонсор `FYoGpYFBMSLH6VUHwHoUXkwyXMSci8fEyHmCC6VCmzZP`.
- Делегация на vote-аккаунт `D1ATVaAXZGNovnT8ej9CcNmTGu8a9LRCkNhYcNrERmqB`.
- Транзакций: 33, комиссии сети: 284 800 лампортов (0,0002848 SOL). На старте у плательщика было ровно 1,0122736 SOL.
- Возврат средств завершён, ключи ролей пусты:
  - Sm `5L3JSz3MwRHAy3971squVrFpV2hwRf6yCaiN6viykJ4b`: Withdraw 0,00166624 SOL плательщику: ok
  - S1 `qXevpsnBQEYEnD5nCWET92wSnNwU3JqEZwV6FzcGsFg`: Withdraw 0,50166624 SOL плательщику: ok
  - S3 `5PQmN7rgqwopdtdtZeaCNy7bK6Gt6LvoxhpsaWyc9H5d`: Withdraw 0,00166624 SOL плательщику: ok
  - остатки ключей ролей (0,50633984 SOL) переведены плательщику: ok

| № | Проверка | Ожидание | Результат | Подпись или код ошибки |
|---|---|---|---|---|
| 1a | Создать стейк-аккаунт S1: staker = withdrawer = A, без замка, 1 SOL сверх залога | успех | совпало: успех; 1,00166624 SOL, staker A, withdrawer A, без замка | `514K…4TPS` |
| 1b | Делегировать S1: DelegateStake с подписью A | успех | совпало: успех; делегирован D1ATVaAXZGNovnT8ej9CcNmTGu8a9LRCkNhYcNrERmqB в эпохе 1000 | `JN7R…2PEH` |
| 2 | Главное утверждение. SetLockupChecked на S1 с подписями A и B: unix_timestamp = сейчас + 1 час, хранитель B | успех | совпало: успех; unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | `5s4g…UUU8` |
| 3 | Withdraw всего S1 с подписью только A | ошибка LockupInForce | совпало: ошибка; баланс S1 не изменился | LockupInForce (код 1), инструкция 3 · `rq8C…Ybvn` |
| 4 | AuthorizeChecked(Withdrawer -> X) с подписями A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · `3ppz…VjwC` |
| 5 | SetLockup (unix_timestamp = 0) с подписью A при действующем замке | ошибка MissingRequiredSignature | совпало: ошибка; unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | MissingRequiredSignature, инструкция 3 · `53vy…kcf4` |
| 6 | SetLockup с подписью B: продление до сейчас + 2 часа | успех | совпало: успех; unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `45g7…hFuo` |
| 7a | Вор с ключом A: Deactivate S1 с подписью A | успех | совпало: успех; deactivation_epoch = 1000 | `2xLW…ywxs` |
| 7b | Вор с ключом A: AuthorizeChecked(Staker -> X) с подписями A и X | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `2gtm…rVt5` |
| 8a | Split S1 в S2 (подпись staker X): у S2 тот же замок | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `4auF…V1bX` |
| 8b | Withdraw всего S2 с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · `UyJE…ipLR` |
| 9 | Merge незапертого Sm (staker X, withdrawer A, как у S1) в запертый S1 | ошибка MergeMismatch | совпало: ошибка; Sm на месте | MergeMismatch (код 6), инструкция 3 · `5wFH…WjMQ` |
| 10 | Withdraw 0,25 SOL из запертого неделегированного S2 с подписями A и B | успех | совпало: успех; на S2 осталось 0,25166624 SOL | `24mG…MVwQ` |
| 11a | Спасение S1 после шага 7, одна транзакция, комиссию платит D: AuthorizeChecked(Staker -> D) с подписями A и D и AuthorizeChecked(Withdrawer -> D) с подписями A, D и B | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `5thu…SgFv` |
| 11b | После спасения: Withdraw из S1 с подписями A и B | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · `edQq…WhkT` |
| 11c | После спасения: AuthorizeChecked(Staker -> X) на S1 с подписями A и X | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · `we6V…aYAW` |
| 12a | D создаёт nonce-аккаунт (CreateAccountWithSeed + InitializeNonceAccount, authority D) | успех | совпало: успех; nonce-аккаунт DrfWehNJWHAWC4UiakNrmWvs9USCnm5ASQyzFYsz15eF, authority D | `2jxT…2u5y` |
| 12b | То же спасение запертого S3 на durable nonce D: подписи D, A, B добавляются по одной, между ними транзакция уходит в ссылку /cosign#tx= и разбирается обратно | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B; nonce сдвинут: да; ссылка /cosign 818 символов | `6A5w…5iJW` |
| 12c | D закрывает nonce-аккаунт и забирает залог | успех | совпало: успех; аккаунт закрыт, всё выведено | `5fom…2uic` |
| 13a | B ставит unix_timestamp = 0 на запертом S2 | успех | совпало: успех; unix_timestamp = 0, хранитель B | `5p2w…reLG` |
| 13b | Withdraw всего S2 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | `2z4Z…7tWr` |
| 14a | S4 заперт B до T: Withdraw с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · `1XCd…oTN1` |
| 14b | Часы переведены за T: SetLockup (unix_timestamp = 0) с подписью только A | успех | совпало: успех; unix_timestamp = 0, хранитель B | `bqSH…womT` |
| 14c | Withdraw всего S4 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | `3xHa…8oPC` |
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
