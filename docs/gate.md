# Проверка механизма

Скрипт `scripts/gate.ts` (CLAUDE.md, шаг 1) проверяет на настоящей стейк-программе правила замка (lockup), на которых
держится Stakeward. Транзакции, которые отправляет и продукт, собирает `buildTransaction` из `packages/core`: формат
из §4 и старый порядок аккаунтов для Ledger (D1). Действия, которых в продукте нет (AuthorizeChecked вора, Split,
Merge, обходные пути из проверки 15), собраны в том же формате. Неудачные транзакции в devnet и mainnet
отправляются без preflight, поэтому у них тоже есть подпись в сети. Ключи: A — основной, B — второй (хранитель
замка), X — staker вора, D — новый кошелёк.

- LiteSVM: `pnpm gate:litesvm`. Тот же прогон идёт в CI как тест `scripts/gate/gate.test.ts`.
- Devnet: `pnpm gate:devnet`. Платит ключ-спонсор `.keys/devnet-funder.json`, ключи ролей прогона лежат в `.keys/gate-devnet-<роль>.json`, в конце всё, кроме комиссий, возвращается спонсору.
- Mainnet: `pnpm gate:mainnet`. Одноразовый ключ `.keys/mainnet-gate.json`, неделегированный аккаунт, проверки 2, 3, 4, 5, 6 и 13, в конце всё выводится обратно на этот ключ.

Адрес RPC задаёт переменная `RPC_URL`, по умолчанию — публичный узел кластера. Каждый прогон переписывает только
свой раздел этого файла.

<!-- gate:litesvm:begin -->
## LiteSVM

Прогон 2026-10-11 19:41:48 UTC: 31 из 31 шагов совпали с ожиданием.

- Стейк-программа: загружена в LiteSVM из фикстуры; programdata `6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`, слот развёртывания 447552000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
- Часы кластера в начале: 2026-10-01 00:00:00 UTC, эпоха 1000.
- Ключи: A `Gmeg2QZQRqYjuXoVLgg1Wvkv7sFg4AhYoMZhFB6f5ViR`, B `BnCpibQKCtL3of6McZSW2svk1heph8ibSNHGSk9s2Vhz`, X `ADuraF9aBx6uLqsy9GSj3vcHS3XY3vw9qA6v7oQjqd8h`, D `56uKUYxuyL3PC79baJ4J38msaocRjsQRBXvhGWeBN3zN`. Спонсор `CNv7s1ndsB52T63j64SgMobDMQ5vcqRxhGanUNP5ZXY2`.
- Делегация на vote-аккаунт `3WxgwX456fCReT5rsHA1ozZiizfsL1H6JCKw8KQPLgiP`.
- Транзакций: 43, комиссии сети: 370 800 лампортов (0,0003708 SOL). На старте у плательщика было ровно 1,02569208 SOL.
- Возврат средств завершён, ключи ролей пусты:
  - S6 `J3Ca6dGF1WuA1AommdxQcjfhGfLwZcwjnf6pVCVod3x9`: Withdraw 0,00166624 SOL плательщику: ok
  - S5 `7obbuAotATqQD2NXWNCosJJc4fGsxTk1gNJpCnCZ5fCM`: Withdraw 0,01166624 SOL плательщику: ok
  - Sm `8E2yi1Y8yjw3XTdhwbkejGLfF7dFLzE8S7id4g9h3cxi`: Withdraw 0,00166624 SOL плательщику: ok
  - S1 `4BgR7cKmVWg9c39GtjyMXb9Pq9DH7rptHusq2gBF4jWF`: Withdraw 0,50166624 SOL плательщику: ok
  - S3 `87Yzva94hwwoRy8PQ5wmCUuUoUDL2wX2nVtGqr9hD1tw`: Withdraw 0,00166624 SOL плательщику: ok
  - остатки ключей ролей (0,50633984 SOL) переведены плательщику: ok

| № | Проверка | Ожидание | Результат | Подпись или код ошибки |
|---|---|---|---|---|
| 1a | Создать стейк-аккаунт S1: staker = withdrawer = A, без замка, 1 SOL сверх залога | успех | совпало: успех; 1,00166624 SOL, staker A, withdrawer A, без замка | `ik9b…aPpT` |
| 1b | Делегировать S1: DelegateStake с подписью A | успех | совпало: успех; делегирован 3WxgwX456fCReT5rsHA1ozZiizfsL1H6JCKw8KQPLgiP в эпохе 1000 | `tLex…DEWD` |
| 2 | Главное утверждение. SetLockupChecked на S1 с подписями A и B: unix_timestamp = сейчас + 1 час, хранитель B | успех | совпало: успех; unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | `5B8o…vY6q` |
| 3 | Withdraw всего S1 с подписью только A | ошибка LockupInForce | совпало: ошибка; баланс S1 не изменился | LockupInForce (код 1), инструкция 3 · `284R…GUHK` |
| 4 | AuthorizeChecked(Withdrawer -> X) с подписями A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · `2srf…P1Uy` |
| 5 | SetLockup (unix_timestamp = 0) с подписью A при действующем замке | ошибка MissingRequiredSignature | совпало: ошибка; unix_timestamp = 2026-10-01 01:00:00 UTC, хранитель B | MissingRequiredSignature, инструкция 3 · `2HB8…tNeL` |
| 6 | SetLockup с подписью B: продление до сейчас + 2 часа | успех | совпало: успех; unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `45ib…9abU` |
| 7a | Вор с ключом A: Deactivate S1 с подписью A | успех | совпало: успех; deactivation_epoch = 1000 | `4W71…dGtE` |
| 7b | Вор с ключом A: AuthorizeChecked(Staker -> X) с подписями A и X | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `5uFi…Q87n` |
| 8a | Split S1 в S2 (подпись staker X): у S2 тот же замок | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `3gVg…D5zE` |
| 8b | Withdraw всего S2 с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · `dF6m…KKq6` |
| 9 | Merge незапертого Sm (staker X, withdrawer A, как у S1) в запертый S1 | ошибка MergeMismatch | совпало: ошибка; Sm на месте | MergeMismatch (код 6), инструкция 3 · `3c87…wC92` |
| 10 | Withdraw 0,25 SOL из запертого неделегированного S2 с подписями A и B | успех | совпало: успех; на S2 осталось 0,25166624 SOL | `5LKZ…bCtF` |
| 11a | Спасение S1 после шага 7, одна транзакция, комиссию платит D: AuthorizeChecked(Staker -> D) с подписями A и D и AuthorizeChecked(Withdrawer -> D) с подписями A, D и B | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B | `2PLe…9Cbt` |
| 11b | После спасения: Withdraw из S1 с подписями A и B | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · `2jxM…xgtp` |
| 11c | После спасения: AuthorizeChecked(Staker -> X) на S1 с подписями A и X | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · `FZSP…ydLa` |
| 12a | D создаёт nonce-аккаунт (CreateAccountWithSeed + InitializeNonceAccount, authority D) | успех | совпало: успех; nonce-аккаунт GpbazAtvNkgUmbd6Jn549HyzHSzr7DUGAG6msg6GGW1V, authority D | `EHLW…57Dn` |
| 12b | То же спасение запертого S3 на durable nonce D: подписи D, A, B добавляются по одной, между ними транзакция уходит в ссылку /cosign#tx= и разбирается обратно | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-01 02:00:00 UTC, хранитель B; nonce сдвинут: да; ссылка /cosign 818 символов | `sxnX…4AWN` |
| 12c | D закрывает nonce-аккаунт и забирает залог | успех | совпало: успех; аккаунт закрыт, всё выведено | `3dNJ…Pf43` |
| 13a | B ставит unix_timestamp = 0 на запертом S2 | успех | совпало: успех; unix_timestamp = 0, хранитель B | `5kgD…r7Qm` |
| 13b | Withdraw всего S2 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | `367U…3AYd` |
| 14a | S4 заперт B до T: Withdraw с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · `4ciz…W1pX` |
| 14b | Часы переведены за T: SetLockup (unix_timestamp = 0) с подписью только A | успех | совпало: успех; unix_timestamp = 0, хранитель B | `2P46…2PBT` |
| 14c | Withdraw всего S4 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | `2CX7…rZxE` |
| 15a | Вор с ключом A: обычный Authorize(Withdrawer -> X) на S5 (staker = withdrawer = A, заперт B), без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-01 02:00:01 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · `XyxA…BRtY` |
| 15b | Вор с ключом A: Authorize(Withdrawer -> X), хранителем подписывает X вместо B | ошибка LockupInForce | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-01 02:00:01 UTC, хранитель B | LockupInForce (код 1), инструкция 3 · `Hzct…D3bC` |
| 15c | Вор с ключом A: AuthorizeWithSeed(Withdrawer -> X), base A, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-01 02:00:01 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · `HUFx…kBh1` |
| 15d | Вор с ключом A: AuthorizeCheckedWithSeed(Withdrawer -> X), base A, подписи A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-01 02:00:01 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · `32Hr…tyrP` |
| 15e | Вор с ключом A: Withdraw всего S5, хранителем подписывает X вместо B | ошибка LockupInForce | совпало: ошибка; балансы S5 и S6 не изменились | LockupInForce (код 1), инструкция 3 · `2hhn…ttqr` |
| 15f | Вор с ключом A: MoveLamports 0,01 SOL из S5 в незапертый S6 с теми же полномочиями (staker = withdrawer = A) | ошибка MergeMismatch | совпало: ошибка; балансы S5 и S6 не изменились | MergeMismatch (код 6), инструкция 3 · `5y4P…4mCy` |
| 15g | Вор с ключом A: MoveStake из S5 в S6 | ошибка MergeMismatch | совпало: ошибка; балансы S5 и S6 не изменились | MergeMismatch (код 6), инструкция 3 · `5YTC…mzfP` |
<!-- gate:litesvm:end -->

<!-- gate:devnet:begin -->
## Devnet

Прогон 2026-10-11 20:09:42 UTC: 28 из 28 шагов совпали с ожиданием.

- Стейк-программа: programdata [`6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`](https://explorer.solana.com/address/6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ?cluster=devnet), слот развёртывания 488592000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
- Часы кластера в начале: 2026-10-11 20:09:41 UTC, эпоха 1180.
- Ключи: A [`DEvRsgZYNgWzb26693fjCELdiqbrPvQ8tatmedKW8ngU`](https://explorer.solana.com/address/DEvRsgZYNgWzb26693fjCELdiqbrPvQ8tatmedKW8ngU?cluster=devnet), B [`CkVaZpYmKQrZygLEqkX7xwagFWksx6navcYEvPv2vLeC`](https://explorer.solana.com/address/CkVaZpYmKQrZygLEqkX7xwagFWksx6navcYEvPv2vLeC?cluster=devnet), X [`BzsSJ3qgk6AfXfgdE4dnPNwkkiP2HnuzcCqH2dJ99ZP8`](https://explorer.solana.com/address/BzsSJ3qgk6AfXfgdE4dnPNwkkiP2HnuzcCqH2dJ99ZP8?cluster=devnet), D [`6PVoKq35tbqaWt51d9YRYBFvEWWaKfT2fduyUv2mJgie`](https://explorer.solana.com/address/6PVoKq35tbqaWt51d9YRYBFvEWWaKfT2fduyUv2mJgie?cluster=devnet). Спонсор [`EcmCPNKzpFTv1WB1CKx6mfrjKWvv2ejje43ajaY4Fgdb`](https://explorer.solana.com/address/EcmCPNKzpFTv1WB1CKx6mfrjKWvv2ejje43ajaY4Fgdb?cluster=devnet).
- Делегация на vote-аккаунт [`vgcDar2pryHvMgPkKaZfh8pQy4BJxv7SpwUG7zinWjG`](https://explorer.solana.com/address/vgcDar2pryHvMgPkKaZfh8pQy4BJxv7SpwUG7zinWjG?cluster=devnet).
- Транзакций: 39, комиссии сети: 348 400 лампортов (0,0003484 SOL). На старте у плательщика было ровно 1,02400344 SOL.
- Возврат средств завершён, ключи ролей пусты:
  - Sm `2BM7L6a1cGcvQYG9ttocM8dXKa4zw725bbMvzqGWmMUa`: Withdraw 0,00166624 SOL плательщику: ok
  - S6 `FVxXKphxKhLQcnUjcSURsrsPYgPdjeTujDa9aWrvPhge`: Withdraw 0,00166624 SOL плательщику: ok
  - S5 `J81So3JL2yU5sadfuF8aCP99Nz86sbvY5UdFv8H2bMqA`: Withdraw 0,01166624 SOL плательщику: ok
  - S3 `6FbY4MFa7nLNzLnyC53U6pZPn5Z1ZubFTscXtSw3ta1e`: Withdraw 0,00166624 SOL плательщику: ok
  - S1 `DYTNYCAPwzStBN2Cdbt34a4SA1RVqthK55zBukV7nGnr`: Withdraw 0,50166624 SOL плательщику: ok
  - остатки ключей ролей (0,5046736 SOL) переведены плательщику: ok

| № | Проверка | Ожидание | Результат | Подпись или код ошибки |
|---|---|---|---|---|
| 1a | Создать стейк-аккаунт S1: staker = withdrawer = A, без замка, 1 SOL сверх залога | успех | совпало: успех; 1,00166624 SOL, staker A, withdrawer A, без замка | [2CGT…P8ki](https://explorer.solana.com/tx/2CGTDpBiFeTn2PRUk7PxehTdUrDPAHb43BJt9RLPcsdXzFWZBuzfnrZNRFJm1RcCXok9YgM9qtXV5aWrvh2iP8ki?cluster=devnet) |
| 1b | Делегировать S1: DelegateStake с подписью A | успех | совпало: успех; делегирован vgcDar2pryHvMgPkKaZfh8pQy4BJxv7SpwUG7zinWjG в эпохе 1180 | [3EFR…VS9n](https://explorer.solana.com/tx/3EFRQUTZFXGfW3G1kvcjUdDAdtT1u3HRFfoocN8JLKoYaSV3JFRXNJrcRDrmWvomwvHTmEyB8NMjiVnvKN8RVS9n?cluster=devnet) |
| 2 | Главное утверждение. SetLockupChecked на S1 с подписями A и B: unix_timestamp = сейчас + 1 час, хранитель B | успех | совпало: успех; unix_timestamp = 2026-10-11 21:09:49 UTC, хранитель B | [5Lfk…r1tm](https://explorer.solana.com/tx/5LfkB1NhXRLuFd2NvQJNsu6mfJ6HVC6sw3Nz8BYrbePRHmGXb853pUQZixJ5xfQVrTE1SsCQPjsM5EUmPpLHr1tm?cluster=devnet) |
| 3 | Withdraw всего S1 с подписью только A | ошибка LockupInForce | совпало: ошибка; баланс S1 не изменился | LockupInForce (код 1), инструкция 3 · [3GiK…ADDd](https://explorer.solana.com/tx/3GiK6b9WCSsm9ZNTeLazZ8zTDXSqZbugmznB8XpSP1qLFYFw3LsJA2sLNtjE7cJLbrxpoo8wzo7G8zdChb84ADDd?cluster=devnet) |
| 4 | AuthorizeChecked(Withdrawer -> X) с подписями A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-11 21:09:49 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · [4SSX…HV1M](https://explorer.solana.com/tx/4SSXi4hEi4x37Wo4ZxoLbhoZDUvDbPVD8nEJAZtRfnif39sgvEE1hQ9cWdv8qjLLZzzW73MkH96F5kbFiHdhHV1M?cluster=devnet) |
| 5 | SetLockup (unix_timestamp = 0) с подписью A при действующем замке | ошибка MissingRequiredSignature | совпало: ошибка; unix_timestamp = 2026-10-11 21:09:49 UTC, хранитель B | MissingRequiredSignature, инструкция 3 · [332Z…ruNH](https://explorer.solana.com/tx/332ZxKL2kuUxN2XGYUAxq7oimp21wuohi59eRDQSXEfgBGSGdoaQjE3sss9djR1idZSPKUbJZDavZBnWh4m1ruNH?cluster=devnet) |
| 6 | SetLockup с подписью B: продление до сейчас + 2 часа | успех | совпало: успех; unix_timestamp = 2026-10-11 22:09:58 UTC, хранитель B | [SZQ8…UtnT](https://explorer.solana.com/tx/SZQ8z1daX12dcaYCark3vGoNfWZUifwgDqaJGsMVVzL3TUfywQrJsFgRTV9mLKDK1EyrJ8JVQtJejVdxkrxUtnT?cluster=devnet) |
| 7a | Вор с ключом A: Deactivate S1 с подписью A | успех | совпало: успех; deactivation_epoch = 1180 | [5DAm…KQub](https://explorer.solana.com/tx/5DAmyEjLtBCMTAgJcu8RKCa8qaG1iBAaCHRLSj49mPqyhHYK4NiF5vPBrAW9jEZ2znJTN9C254EUoYWcNgGgKQub?cluster=devnet) |
| 7b | Вор с ключом A: AuthorizeChecked(Staker -> X) с подписями A и X | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-11 22:09:58 UTC, хранитель B | [3VkR…bvaM](https://explorer.solana.com/tx/3VkRTbCvJHk263mHzGmXfQiviZ5S4RP8kAt32FNvZN5hg8CRwUeASdKgWF1PV9xQZhoLaRy5VnST8xwN9pcJbvaM?cluster=devnet) |
| 8a | Split S1 в S2 (подпись staker X): у S2 тот же замок | успех | совпало: успех; staker X, withdrawer A, unix_timestamp = 2026-10-11 22:09:58 UTC, хранитель B | [kuMi…SVXz](https://explorer.solana.com/tx/kuMiDWeEHjAUpxaHb6sE5KWE5obyQyG23XsmNuSubYz3CE8WjJMYhmympXmjp9S1oaAX2z5QqCVAmnDqEi6SVXz?cluster=devnet) |
| 8b | Withdraw всего S2 с подписью только A | ошибка LockupInForce | совпало: ошибка | LockupInForce (код 1), инструкция 3 · [5KVL…DYmj](https://explorer.solana.com/tx/5KVLQQmyj4qADYM8JfbVNJYsY3Tm8r9KhrXE9xaCeDPvvSx2rUwku2EBpCzgQa8k8MdXif7WGyMoTCRaHmd4DYmj?cluster=devnet) |
| 9 | Merge незапертого Sm (staker X, withdrawer A, как у S1) в запертый S1 | ошибка MergeMismatch | совпало: ошибка; Sm на месте | MergeMismatch (код 6), инструкция 3 · [67cA…Z2TC](https://explorer.solana.com/tx/67cAp36ZnFrG3JQ9JfLrbXwzUzcEv83LnYvNdyE9GV5gQSLBvYumvuNUK9K42KrZDWfTKvRJfdPifr1AT7UiZ2TC?cluster=devnet) |
| 10 | Withdraw 0,25 SOL из запертого неделегированного S2 с подписями A и B | успех | совпало: успех; на S2 осталось 0,25166624 SOL | [8uQs…9HLb](https://explorer.solana.com/tx/8uQsaseaZyt7VWQxw8Lx4zYQBhA5cAEURravxDdUWFbFyGNfRiGg15yw1JHK2QCwgfaGJ9HoipCRQCNctxx9HLb?cluster=devnet) |
| 11a | Спасение S1 после шага 7, одна транзакция, комиссию платит D: AuthorizeChecked(Staker -> D) с подписями A и D и AuthorizeChecked(Withdrawer -> D) с подписями A, D и B | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-11 22:09:58 UTC, хранитель B | [445s…bdUL](https://explorer.solana.com/tx/445sQdWgaNwnviyTqA7XCzAuUojuxL34dK2KXXwPXUtHymTWgHsafam8K8W51M4jGFUMd7nEfEb4VFYCF4nAbdUL?cluster=devnet) |
| 11b | После спасения: Withdraw из S1 с подписями A и B | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · [3NjQ…6hJQ](https://explorer.solana.com/tx/3NjQXo39vFKowEsAyMrCNtMxKJ88KYbGgH7fsFSqZoBj77eDKkRSDzBsSPwdWBtinqVou5MsgFLf1fqjhyaJ6hJQ?cluster=devnet) |
| 11c | После спасения: AuthorizeChecked(Staker -> X) на S1 с подписями A и X | любая ошибка стейк-программы | совпало: ошибка | MissingRequiredSignature, инструкция 3 · [3bAA…cYLc](https://explorer.solana.com/tx/3bAAB6kyBG2g5j4PgUAm2sj1zKZRAD9ngpjdwm78M2MwiEfiGYWQzK5rQefN7j5yDsfgXBfiwWabZgvWKsFycYLc?cluster=devnet) |
| 12a | D создаёт nonce-аккаунт (CreateAccountWithSeed + InitializeNonceAccount, authority D) | успех | совпало: успех; nonce-аккаунт 5i28k9VpjfDRSbpWpnkUZdmvoE2EPbR9AHdCdu7YcgZB, authority D | [4d1M…6VMP](https://explorer.solana.com/tx/4d1MRoLwohi9MCWcffyxGZV2VMRm8TwZeTjz3AtZW8kTDM5Uwmaig8CEyoGpXv53EbF43RmyBUZxgvgY1jYn6VMP?cluster=devnet) |
| 12b | То же спасение запертого S3 на durable nonce D: подписи D, A, B добавляются по одной, между ними транзакция уходит в ссылку /cosign#tx= и разбирается обратно | успех | совпало: успех; staker D, withdrawer D, unix_timestamp = 2026-10-11 22:10:26 UTC, хранитель B; nonce сдвинут: да; ссылка /cosign 818 символов | [44ch…SyPi](https://explorer.solana.com/tx/44chhSnfopMNHNvBqmWBDphvZ4MVLfsCui8wkbSjQXt3vYtA8uGGK9i6LsMLwK2aMmSZua7VQseRjCfKNsfwSyPi?cluster=devnet) |
| 12c | D закрывает nonce-аккаунт и забирает залог | успех | совпало: успех; аккаунт закрыт, всё выведено | [2a28…oxQ7](https://explorer.solana.com/tx/2a28Wv7mjF6horebVFsyxE9gft8YDdH5xZRiBmHPqnmwb6Vn6sWhGfjzatkqFL5vqYB2uSizk7EpshUCPP8HoxQ7?cluster=devnet) |
| 13a | B ставит unix_timestamp = 0 на запертом S2 | успех | совпало: успех; unix_timestamp = 0, хранитель B | [TUqg…1a6S](https://explorer.solana.com/tx/TUqgKuTTLG7eWFncW1CPtJFnHvYpDaMqdV2SBje5t1Eyg8o24FjUy2PpBfAemNnAkveTsKhb4tiAnk2fVkv1a6S?cluster=devnet) |
| 13b | Withdraw всего S2 с подписью только A | успех | совпало: успех; аккаунт закрыт, всё выведено | [5dmV…jDTc](https://explorer.solana.com/tx/5dmVJLTnGizp48LCunJZG2hCCUr84jKe1YoF3Pwg1Kzh7yYP6VyqKkzA6kWkkVzxCtrTCrVmajVxpgVYT4EXjDTc?cluster=devnet) |
| 15a | Вор с ключом A: обычный Authorize(Withdrawer -> X) на S5 (staker = withdrawer = A, заперт B), без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-11 21:10:40 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · [Vbuq…jbZE](https://explorer.solana.com/tx/Vbuq8MwmtKutUhTkPwXq5yXaqk8bS9XWiemnWZzpFgzwRY14iSyMA9o6SVhrD5yUHLfSzSrgH9b5KgFQsqfjbZE?cluster=devnet) |
| 15b | Вор с ключом A: Authorize(Withdrawer -> X), хранителем подписывает X вместо B | ошибка LockupInForce | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-11 21:10:40 UTC, хранитель B | LockupInForce (код 1), инструкция 3 · [5Qwd…7EAo](https://explorer.solana.com/tx/5Qwd9K8YN4abi1KjX55EMYgiX8Ryy7z1MWZad3BxJPTiAjKEDh2oEp3VEVyupWN3oN2bj5drP471a9Mc6N3a7EAo?cluster=devnet) |
| 15c | Вор с ключом A: AuthorizeWithSeed(Withdrawer -> X), base A, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-11 21:10:40 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · [66i4…tTva](https://explorer.solana.com/tx/66i46NuK29HZNqXgzgRnCAL8S76MehhQNmA1NwufXVUfez2nJ8xmMNu6co9ftguvTDFAGYZ4kebDcrUxGzAXtTva?cluster=devnet) |
| 15d | Вор с ключом A: AuthorizeCheckedWithSeed(Withdrawer -> X), base A, подписи A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-11 21:10:40 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · [3774…TscF](https://explorer.solana.com/tx/3774SFAsHWxGbS7JDc4XsFQT42oVNKajqejNSt3uqM6xowVxfSrQanXL659eBsoq3M6XLyytJg4htB4UmERCTscF?cluster=devnet) |
| 15e | Вор с ключом A: Withdraw всего S5, хранителем подписывает X вместо B | ошибка LockupInForce | совпало: ошибка; балансы S5 и S6 не изменились | LockupInForce (код 1), инструкция 3 · [4VC1…mbSu](https://explorer.solana.com/tx/4VC1KsEzdhLVTaWYsayeErYnFTDTkKjL16HEnVLg16ekWFNSfSuXqxKtLeygjRB2Btf8C344kew1NASDo2W3mbSu?cluster=devnet) |
| 15f | Вор с ключом A: MoveLamports 0,01 SOL из S5 в незапертый S6 с теми же полномочиями (staker = withdrawer = A) | ошибка MergeMismatch | совпало: ошибка; балансы S5 и S6 не изменились | MergeMismatch (код 6), инструкция 3 · [3WKd…zuak](https://explorer.solana.com/tx/3WKdntk7nsyx17CgpW4eRD96DqEmZwHpbiz4TNXfqTaj9ekoJrk6rL4sttxyzPLY7ZN6seQKZdA1qwvM5eJNzuak?cluster=devnet) |
| 15g | Вор с ключом A: MoveStake из S5 в S6 | ошибка MergeMismatch | совпало: ошибка; балансы S5 и S6 не изменились | MergeMismatch (код 6), инструкция 3 · [n9E9…MgHH](https://explorer.solana.com/tx/n9E95S3mopFwy4ZjtwQHn91Yc228giimDxaftiuh7oYEM2xf5QXajTprdkoifuLuvkBG1f2M23Gc8nF1R71MgHH?cluster=devnet) |
<!-- gate:devnet:end -->

<!-- gate:mainnet:begin -->
## Mainnet

Прогон 2026-10-05 19:19:14 UTC: 8 из 8 шагов совпали с ожиданием.

- Стейк-программа: programdata [`6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ`](https://explorer.solana.com/address/6WU8Nxarf9fudRK5atWwjLY4vFaw5UrrWhL88qz7iCMJ), слот развёртывания 443232000, ELF 212 056 байт, sha256 `3d2d39c596ce8be2d47816b4ee5db9fc759d80fde54b08c930ad0b6daed64c2c`: совпадает с релизом program@v5.1.0 (фикстура `packages/core/test/fixtures/programs/stake-v5.1.0.so`).
- Часы кластера в начале: 2026-10-05 19:19:13 UTC, эпоха 1050.
- Ключи: A [`7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v`](https://explorer.solana.com/address/7fmyecft8rfkYpndpyAsm74TCZCn1NfMpAtzZD2Y9f6v), B [`FqwiJYpUropcknUZjfbFDoHibx9NV5obu6Vxuh37RvKy`](https://explorer.solana.com/address/FqwiJYpUropcknUZjfbFDoHibx9NV5obu6Vxuh37RvKy), X [`5ALW9faRpdoPiCnkhyJwJ2vNhPLkLA8DydSiqCwZA36a`](https://explorer.solana.com/address/5ALW9faRpdoPiCnkhyJwJ2vNhPLkLA8DydSiqCwZA36a). A — одноразовый ключ `.keys/mainnet-gate.json`, он же платит.
- Транзакций: 8, комиссии сети: 64 800 лампортов (0,0000648 SOL). На старте у плательщика было ровно 0,00238128 SOL.
- Возврат средств завершён, ключи ролей пусты.

| № | Проверка | Ожидание | Результат | Подпись или код ошибки |
|---|---|---|---|---|
| 1a | Создать неделегированный стейк-аккаунт S1: staker = withdrawer = A, без замка | успех | совпало: успех; 0,00166624 SOL, staker A, withdrawer A, без замка | [2bh5…S4Qt](https://explorer.solana.com/tx/2bh5rdCVCmaB1pf2U9gw5M66F1pkxukEicUbFSpHL3FVXWFhh8poHggTVTmsLAHA3p9NiBohshZuHaWpoX6CS4Qt) |
| 2 | Главное утверждение. SetLockupChecked на S1 с подписями A и B: unix_timestamp = сейчас + 1 час, хранитель B | успех | совпало: успех; unix_timestamp = 2026-10-05 20:19:19 UTC, хранитель B | [5w6k…pt9W](https://explorer.solana.com/tx/5w6kvDNJMs83Hb33ZaWS6fo2oSFq1jvazZvCcFfdjAppa7a7nXUGGeUwS2PbxSd9A8NK7Jer14XcSvUGaWNCpt9W) |
| 3 | Withdraw всего S1 с подписью только A | ошибка LockupInForce | совпало: ошибка; баланс S1 не изменился | LockupInForce (код 1), инструкция 3 · [Antz…jLVw](https://explorer.solana.com/tx/AntzPaGpqwGtJ2cuBDwkUyG8Rqi4UwusuRJbrQA3v7qWwmS66hez8SMHuC5Zy1EE9tq64H54EVVsp3bthETjLVw) |
| 4 | AuthorizeChecked(Withdrawer -> X) с подписями A и X, без хранителя | ошибка CustodianMissing | совпало: ошибка; staker A, withdrawer A, unix_timestamp = 2026-10-05 20:19:19 UTC, хранитель B | CustodianMissing (код 7), инструкция 3 · [5Qxo…LUZo](https://explorer.solana.com/tx/5Qxos9NKwaPu8Ci9eZpjktgfKN31Exktjn9rGmj4UbDiubBTfCoGb3yhDCy71noKoB8wqkviks8A4Lyqja1zLUZo) |
| 5 | SetLockup (unix_timestamp = 0) с подписью A при действующем замке | ошибка MissingRequiredSignature | совпало: ошибка; unix_timestamp = 2026-10-05 20:19:19 UTC, хранитель B | MissingRequiredSignature, инструкция 3 · [2M29…b15r](https://explorer.solana.com/tx/2M29CjDvd2SZLPWoupbdPetQTNXGZTQbiUEMW183Gpx9rfQ12gvkYb7UHpefpwgeqAx8aF6BD1KTimYxPvyfb15r) |
| 6 | SetLockup с подписью B: продление до сейчас + 2 часа | успех | совпало: успех; unix_timestamp = 2026-10-05 21:19:29 UTC, хранитель B | [5hPW…AiQ2](https://explorer.solana.com/tx/5hPWGAurhptWxaNNn68Zau5h9LkMXxgXDsj1ZDqnie6yD19Lmpi2GHsdP2jJivJRyZx782Rr6LSjWGS7rxy7AiQ2) |
| 13a | B ставит unix_timestamp = 0 на S1 (комиссию платит A) | успех | совпало: успех; unix_timestamp = 0, хранитель B | [3Pzi…r4fB](https://explorer.solana.com/tx/3PzifCBLEpsh27coif52rukB1oic57kBg1QVRaLnqhcWJBxoa5HooQFba8RwNeKoX9KTsoGRMYt9khdo9bTSr4fB) |
| 13b | Withdraw всего S1 с подписью только A, обратно на одноразовый ключ | успех | совпало: успех; аккаунт закрыт, всё выведено | [u4iv…Whg1](https://explorer.solana.com/tx/u4ivXqSoCSjfNwRqYVLoaEfSs9zXdUyggVPPEeAeSRxRkopw6VkQKtREtjtMa4gyzCArMUV2WwEsRNhzrCxWhg1) |
<!-- gate:mainnet:end -->
